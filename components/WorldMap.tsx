"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { select } from "d3-selection";
import "d3-transition";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import world from "world-atlas/countries-110m.json";
import { ranked } from "@/lib/calc";
import type { Dataset, Flow } from "@/lib/types";

const WIDTH = 960;
const HEIGHT = 500;
const MAX_STROKE = 16;
const MAX_ZOOM = 12;
/** Snelheid van de bewegende bolletjes in kaartpixels per seconde. Laag = rustig. */
const PARTICLE_SPEED = 40;
/** Alleen de grootste landen krijgen een lijn; de rest is een klikbare stip. */
const MAX_LINES = 25;
const NL_ID = "528";
const NL_COORDS: [number, number] = [5.3, 52.2];

const topo = world as unknown as Topology<{ countries: GeometryCollection }>;
const countriesGeo = feature(topo, topo.objects.countries) as FeatureCollection<Geometry, { name: string }>;
const shapes = countriesGeo.features.filter((f) => f.id !== "010"); // zonder Antarctica

const projection = geoNaturalEarth1().fitExtent(
  [[12, 12], [WIDTH - 12, HEIGHT - 12]],
  { type: "FeatureCollection", features: shapes },
);
const pathGen = geoPath(projection);
const project = (c: [number, number]) => projection(c) as [number, number];

/** Zoomstand die een gebied (lengte/breedte-hoeken) vult. */
function fitBounds(sw: [number, number], ne: [number, number]): ZoomTransform {
  const [x0, y1] = project(sw);
  const [x1, y0] = project(ne);
  const k = Math.min(MAX_ZOOM, 0.95 * Math.min(WIDTH / (x1 - x0), HEIGHT / (y1 - y0)));
  return zoomIdentity
    .translate(WIDTH / 2, HEIGHT / 2)
    .scale(k)
    .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
}

const PRESETS = {
  wereld: zoomIdentity,
  europa: fitBounds([-11, 36], [30, 63]),
};

interface Props {
  data: Dataset;
  resolved: Map<string, Flow[]>;
  /** Formatteert een bedrag (mln euro) in de gekozen eenheid. */
  fmt: (amountMln: number, signed?: boolean) => string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

interface Hover {
  id: string;
  x: number;
  y: number;
}

/** Gebogen lijn van a naar b; door a en b om te draaien buigt hij naar de andere kant. */
function curve(a: [number, number], b: [number, number], bend: number): string {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const cx = (x1 + x2) / 2 - (y2 - y1) * bend;
  const cy = (y1 + y2) / 2 + (x2 - x1) * bend;
  return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
}

const nl = project(NL_COORDS);

export default function WorldMap({ data, resolved, fmt, selectedId, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [hover, setHover] = useState<Hover | null>(null);
  const [moving, setMoving] = useState(true);

  // Zoomen en verslepen: muiswiel, slepen, dubbelklik, knijpen met twee vingers.
  useEffect(() => {
    const svg = select(svgRef.current!);
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, MAX_ZOOM])
      .translateExtent([[0, 0], [WIDTH, HEIGHT]])
      // Op touch pas zoomen/slepen met twee vingers, zodat je met één vinger de pagina kunt scrollen.
      .filter((e: Event) => {
        if (e.type === "touchstart") return (e as TouchEvent).touches.length > 1;
        return (!(e as MouseEvent).ctrlKey || e.type === "wheel") && !(e as MouseEvent).button;
      })
      .on("zoom", (e) => {
        setTransform(e.transform);
        setHover(null);
      });
    svg.call(behavior).style("touch-action", "pan-x pan-y");
    zoomRef.current = behavior;
    return () => {
      svg.on(".zoom", null);
    };
  }, []);

  const zoomTo = (t: ZoomTransform) => {
    if (!zoomRef.current || !svgRef.current) return;
    select(svgRef.current).transition().duration(600).call(zoomRef.current.transform, t);
  };
  const zoomBy = (factor: number) => {
    if (!zoomRef.current || !svgRef.current) return;
    select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, factor);
  };

  const flows = useMemo(() => {
    const rows = ranked(data, resolved).map((r, i) => ({ ...r, line: i < MAX_LINES || r.country.id === selectedId }));
    const max = Math.max(1e-9, ...rows.filter((r) => r.line).flatMap((r) => [r.t.uit, r.t.in]));
    const width = (v: number) => (v > 0 ? Math.max(1.2, Math.sqrt(v / max) * MAX_STROKE) : 0);
    return rows
      .map((r) => {
        const end = project(r.country.coords);
        return {
          ...r,
          end,
          dUit: curve(nl, end, 0.18),
          dIn: curve(end, nl, 0.18),
          dist: Math.hypot(end[0] - nl[0], end[1] - nl[1]),
          wUit: r.line ? width(r.t.uit) : 0,
          wIn: r.line ? width(r.t.in) : 0,
        };
      })
      // Dunne lijnen bovenop dikke, zodat alles klikbaar blijft.
      .sort((a, b) => b.t.uit + b.t.in - (a.t.uit + a.t.in));
  }, [data, resolved, selectedId]);

  const dataIds = useMemo(() => new Set(flows.map((f) => f.country.id)), [flows]);
  const focusId = hover?.id ?? selectedId;

  const pick = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(id);
  };
  const track = (id: string) => (e: React.MouseEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    setHover({ id, x: e.clientX - r.left, y: e.clientY - r.top });
  };

  // Landen en lijnen hangen niet af van de zoomstand; memoïseren houdt pannen soepel.
  const landLayer = useMemo(
    () =>
      shapes.map((f) => {
        const id = String(f.id);
        const hasData = dataIds.has(id);
        const cls = [
          "land",
          id === NL_ID && "land--nl",
          hasData && "land--data",
          id === selectedId && "land--selected",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <path
            key={id + f.properties.name}
            d={pathGen(f) ?? undefined}
            className={cls}
            onClick={hasData ? pick(id) : undefined}
            onMouseMove={hasData ? track(id) : undefined}
            onMouseLeave={hasData ? () => setHover(null) : undefined}
          />
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataIds, selectedId],
  );

  const flowLayer = useMemo(
    () =>
      flows.filter((f) => f.line).map(({ country, dUit, dIn, wUit, wIn }) => {
        const cls = ["flow", focusId && (focusId === country.id ? "flow--focus" : "flow--dimmed")]
          .filter(Boolean)
          .join(" ");
        return (
          <g
            key={country.id}
            className={cls}
            onClick={pick(country.id)}
            onMouseMove={track(country.id)}
            onMouseLeave={() => setHover(null)}
          >
            {wUit > 0 && <path d={dUit} className="flow__line flow__line--uit" strokeWidth={wUit} />}
            {wIn > 0 && <path d={dIn} className="flow__line flow__line--in" strokeWidth={wIn} />}
          </g>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flows, focusId],
  );

  // Bolletjes die langzaam over de lijnen glijden: meer en groter bij een grotere geldstroom.
  const k = transform.k;
  const particleLayer = useMemo(() => {
    if (!moving) return null;
    const dur = (dist: number) => Math.min(12, Math.max(3.5, dist / PARTICLE_SPEED));
    const particles = (key: string, d: string, w: number, dist: number, tone: "uit" | "in") => {
      if (w <= 0) return null;
      const count = Math.max(1, Math.round(w / 4));
      const seconds = dur(dist);
      const r = (2.2 + w * 0.16) / k;
      return Array.from({ length: count }, (_, i) => (
        <circle key={key + i} r={r} className={`particle particle--${tone}`} opacity={0}>
          <animateMotion dur={`${seconds}s`} begin={`${(-i * seconds) / count}s`} repeatCount="indefinite" path={d} />
          <animate
            attributeName="opacity"
            values="0;1;1;0"
            keyTimes="0;0.15;0.85;1"
            dur={`${seconds}s`}
            begin={`${(-i * seconds) / count}s`}
            repeatCount="indefinite"
          />
        </circle>
      ));
    };
    return flows.filter((f) => f.line).map(({ country, dUit, dIn, wUit, wIn, dist }) => (
      <g
        key={country.id}
        className={focusId && focusId !== country.id ? "particles particles--dimmed" : "particles"}
      >
        {particles("u", dUit, wUit, dist, "uit")}
        {particles("i", dIn, wIn, dist, "in")}
      </g>
    ));
  }, [flows, focusId, k, moving]);

  const hovered = hover && flows.find((f) => f.country.id === hover.id);
  const [nlx, nly] = transform.apply(nl);

  return (
    <div className="map-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        className="map"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Interactieve wereldkaart met geldstromen van en naar Nederland"
        onClick={() => onSelect(null)}
      >
        <g transform={transform.toString()}>
          <g>{landLayer}</g>
          <g>{flowLayer}</g>
          <g>{particleLayer}</g>
        </g>

        {/* Punten en labels in schermruimte, zodat ze bij inzoomen even groot blijven. */}
        {[...flows].reverse().map(({ country, end, line }) => {
          const [x, y] = transform.apply(end);
          const focus = focusId === country.id;
          return (
            <g
              key={country.id}
              className={["dot", !line && "dot--minor", focusId && !focus && "dot--dimmed"].filter(Boolean).join(" ")}
              onClick={pick(country.id)}
              onMouseMove={track(country.id)}
              onMouseLeave={() => setHover(null)}
            >
              <circle cx={x} cy={y} r={10} className="dot__hit" />
              <circle cx={x} cy={y} r={focus ? 5.5 : line ? 4 : 2.5} className="dot__mark" />
              {(focus || (line && transform.k >= 3) || transform.k >= 6) && (
                <text x={x} y={y - 9} className="map-label" textAnchor="middle">
                  {country.name}
                </text>
              )}
            </g>
          );
        })}
        <circle cx={nlx} cy={nly} r={7} className="nl-dot" />
        <text x={nlx} y={nly - 12} className="map-label map-label--nl" textAnchor="middle">
          NL
        </text>
      </svg>

      <div className="map-tools">
        <button onClick={() => zoomBy(1.6)} aria-label="Inzoomen">+</button>
        <button onClick={() => zoomBy(1 / 1.6)} aria-label="Uitzoomen">−</button>
        <button onClick={() => zoomTo(PRESETS.europa)}>Europa</button>
        <button onClick={() => zoomTo(PRESETS.wereld)}>Wereld</button>
        <button
          onClick={() => setMoving((m) => !m)}
          aria-pressed={!moving}
          aria-label={moving ? "Beweging pauzeren" : "Beweging hervatten"}
          title={moving ? "Beweging pauzeren" : "Beweging hervatten"}
        >
          {moving ? "❚❚" : "▶"}
        </button>
      </div>

      {hovered && hover && (
        <div
          className="tooltip"
          style={{
            left: hover.x,
            top: hover.y,
            transform: `translate(${hover.x > (wrapRef.current?.clientWidth ?? 0) - 220 ? "calc(-100% - 14px)" : "14px"}, -50%)`,
          }}
        >
          <strong>{hovered.country.name}</strong>
          <div className="tooltip__row">
            <span className="tone-uit">NL → land</span>
            <span>{fmt(hovered.t.uit)}</span>
          </div>
          <div className="tooltip__row">
            <span className="tone-in">Land → NL</span>
            <span>{fmt(hovered.t.in)}</span>
          </div>
          <div className="tooltip__row tooltip__net">
            <span>Netto</span>
            <span>{fmt(hovered.t.netto, true)}</span>
          </div>
          <div className="tooltip__hint">Klik voor details</div>
        </div>
      )}
    </div>
  );
}
