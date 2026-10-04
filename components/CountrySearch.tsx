"use client";

import { useId, useMemo, useState } from "react";
import type { Country } from "@/lib/types";
import type { Strings } from "@/lib/i18n";

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Zoekveld met suggesties; zoekt ook op de naam in de andere taal ("Germany" vindt Duitsland). */
export default function CountrySearch({ countries, onSelect, t }: { countries: Country[]; onSelect: (id: string) => void; t: Strings }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  const matches = useMemo(() => {
    const n = norm(q.trim());
    if (!n) return [];
    const score = (c: Country) => {
      const a = norm(c.name);
      const b = norm(c.altName ?? "");
      if (a.startsWith(n)) return 0;
      if (b.startsWith(n)) return 1;
      if (a.includes(n) || b.includes(n)) return 2;
      return 9;
    };
    return countries
      .map((c) => ({ c, s: score(c) }))
      .filter((x) => x.s < 9)
      .sort((x, y) => x.s - y.s || x.c.name.localeCompare(y.c.name))
      .slice(0, 8)
      .map((x) => x.c);
  }, [q, countries]);

  const choose = (c: Country) => {
    onSelect(c.id);
    setQ("");
    setOpen(false);
  };

  return (
    <div className="search">
      <label className="sr-only" htmlFor={`${listId}-input`}>
        {t.searchLabel}
      </label>
      <input
        id={`${listId}-input`}
        className="search__input"
        type="search"
        placeholder={t.search}
        value={q}
        role="combobox"
        aria-expanded={open && q.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={matches[active] ? `${listId}-${matches[active].id}` : undefined}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, matches.length - 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          else if (e.key === "Enter" && matches[active]) (e.preventDefault(), choose(matches[active]));
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && q.trim() && (
        <ul className="search__list" id={listId} role="listbox">
          {matches.length === 0 && <li className="search__empty">{t.noResults}</li>}
          {matches.map((c, i) => (
            <li
              key={c.id}
              id={`${listId}-${c.id}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "is-active" : undefined}
              onMouseDown={(e) => (e.preventDefault(), choose(c))}
              onMouseEnter={() => setActive(i)}
            >
              {c.name}
              {c.altName && c.altName !== c.name && <span className="muted small"> · {c.altName}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
