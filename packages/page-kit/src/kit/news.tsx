import { parseDay } from "./calendar.js";
import { linkUrl } from "./controls.js";
import { useOpenViaHost } from "./host-bridge.js";
import { objectItems } from "./items.js";
import { useWords } from "./labels.js";
import { imageSource, Picture, text } from "./media.js";

type Source = string | { name?: string; href?: string };

type NewsItem = {
  title?: string;
  summary?: string;
  label?: string;
  image?: string;
  alt?: string;
  sources?: Source[];
};

type UpcomingItem = {
  date?: string;
  title?: string;
  detail?: string;
  sources?: Source[];
};

/** A source is a name, or a name with the page it came from; a bare link falls back to its site. */
function readSources(list: unknown): { name: string; href?: string }[] {
  return (Array.isArray(list) ? list : []).flatMap((entry) => {
    const named = typeof entry === "string" ? { name: entry } : entry;
    if (!named || typeof named !== "object") return [];
    const href = linkUrl((named as { href?: unknown }).href);
    const given = text((named as { name?: unknown }).name);
    const name = given || (href ? new URL(href).hostname.replace(/^www\./, "") : "");
    return name ? [{ name, href }] : [];
  });
}

/** The first source as a small pill, with how many others stand behind it ("Reuters +1"). */
function SourceChip({ sources }: { sources?: unknown }) {
  const openLink = useOpenViaHost();
  const words = useWords();
  const [first, ...others] = readSources(sources);
  if (!first) return null;
  const inner = (
    <>
      <span className="rk-source-mark" aria-hidden="true">
        {first.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="rk-source-name">{first.name}</span>
      {others.length ? <span aria-hidden="true">+{words.number(others.length)}</span> : null}
    </>
  );
  const label = [first.name, ...others.map((source) => source.name)].join(", ");
  return first.href ? (
    <a
      className="rk-source-chip"
      href={first.href}
      title={label}
      rel="noopener noreferrer"
      onClick={openLink}
    >
      {inner}
    </a>
  ) : (
    <span className="rk-source-chip" title={label}>
      {inner}
    </span>
  );
}

/**
 * News as a plain list, one row per story: a photo on the left, then a short label, the headline,
 * a summary and a source chip. Rows are divided by hairlines and sit directly on the answer.
 */
export function NewsRows({ items }: { items?: NewsItem[] }) {
  const rows = objectItems(items).filter((item) => text(item.title));
  if (rows.length === 0) return null;
  return (
    <ul className="rk-news">
      {rows.map((item, index) => {
        const src = imageSource(item.image);
        const label = text(item.label);
        const summary = text(item.summary);
        return (
          <li className="rk-news-row" key={index} data-photo={src ? true : undefined}>
            {src ? (
              <div className="rk-news-photo">
                <Picture source={src} alt={text(item.alt) || text(item.title)} />
              </div>
            ) : null}
            <div className="rk-news-body">
              {label ? <p className="rk-news-label">{label}</p> : null}
              <p className="rk-news-title">{text(item.title)}</p>
              {summary ? <p className="rk-news-summary">{summary}</p> : null}
              <SourceChip sources={item.sources} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** What happens next, each event with a date tile: the day and month large, the weekday small. */
export function Upcoming({ items }: { items?: UpcomingItem[] }) {
  const words = useWords();
  const rows = objectItems(items).flatMap((item) => {
    const day = parseDay(item.date);
    return day && text(item.title) ? [{ item, time: day.getTime() }] : [];
  });
  if (rows.length === 0) return null;
  return (
    <ul className="rk-news">
      {rows.map(({ item, time }, index) => (
        <li className="rk-news-row" key={index}>
          <time className="rk-date-tile" dateTime={text(item.date)}>
            <span className="rk-date-day">
              {words.date(time, { day: "numeric", month: "short", timeZone: "UTC" })}
            </span>
            <span className="rk-date-weekday">
              {words.date(time, { weekday: "long", timeZone: "UTC" })}
            </span>
          </time>
          <div className="rk-news-body">
            <p className="rk-news-title">{text(item.title)}</p>
            {text(item.detail) ? <p className="rk-news-summary">{text(item.detail)}</p> : null}
            <SourceChip sources={item.sources} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export const NEWS_CSS = `
.rk-news{margin:0;padding:0;list-style:none;display:flex;flex-direction:column}
.rk-news-row{display:flex;align-items:flex-start;gap:14px;padding:14px 0;min-width:0}
.rk-news-row+.rk-news-row{border-top:1px solid var(--rk-hairline)}
.rk-news-row:first-child{padding-top:0}
.rk-news-row:last-child{padding-bottom:0}
.rk-news-photo{flex:none;width:38%;max-width:200px}
.rk-news-photo .rk-picture{aspect-ratio:4/3;width:100%;border-radius:14px}
.rk-news-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;align-items:flex-start}
.rk-news-label{margin:0;font-size:13px;line-height:18px;color:var(--rk-secondary)}
.rk-news-title{margin:0;font-size:16px;line-height:22px;font-weight:600;overflow-wrap:anywhere}
.rk-news-summary{margin:0;font-size:14px;line-height:20px;color:var(--rk-secondary);overflow-wrap:anywhere}
.rk-source-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;margin-top:2px;padding:2px 8px 2px 4px;border-radius:9999px;background:var(--rk-fill);color:var(--rk-secondary);font-size:12px;line-height:18px;text-decoration:none}
a.rk-source-chip:hover{background:var(--rk-track)}
a.rk-source-chip:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.rk-source-mark{display:flex;flex:none;align-items:center;justify-content:center;width:16px;height:16px;border-radius:9999px;background:var(--rk-control);font-size:10px;line-height:16px;font-weight:600}
.rk-source-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rk-date-tile{flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:76px;padding:10px 8px;border-radius:14px;background:var(--rk-fill);text-align:center}
.rk-date-day{font-size:17px;line-height:22px;font-weight:600;white-space:nowrap}
.rk-date-weekday{font-size:12px;line-height:16px;color:var(--rk-secondary)}
@media print{.rk-news-row{break-inside:avoid}}
`;
