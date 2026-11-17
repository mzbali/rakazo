import type { CitationGroup, SourceItem } from "@rakazo/core/answer-sources";
import { Popover, PopoverContent, PopoverTrigger } from "@rakazo/ui-web";
import { GlobeIcon } from "./icons";
import { useLinkFavicon } from "./markdown";
import { useMarkdownCopy } from "./markdown-copy";

/** The site's icon before a link or citation, or a globe when it has none. */
export function LinkFavicon({ href }: { href: string }) {
  const { icon, unusable } = useLinkFavicon(href);
  return (
    <span
      aria-hidden="true"
      className={icon ? "rk-chat-link-tile rk-chat-link-tile-icon" : "rk-chat-link-tile"}
    >
      {icon ? (
        <img
          src={icon}
          alt=""
          draggable={false}
          onLoad={(event) => {
            // A 1×1 image is a tracking pixel, not an icon.
            const image = event.currentTarget;
            if (image.naturalWidth <= 1 || image.naturalHeight <= 1) unusable();
          }}
          onError={unusable}
        />
      ) : (
        <GlobeIcon />
      )}
    </span>
  );
}

function SourceList({
  items,
  onOpen,
}: {
  items: readonly SourceItem[];
  onOpen: (url: string) => void;
}) {
  return (
    <ul className="rk-chat-cite-list">
      {items.map((item) => (
        <li key={item.url}>
          <button type="button" className="rk-chat-cite-source" onClick={() => onOpen(item.url)}>
            <LinkFavicon href={item.url} />
            <span className="rk-chat-cite-source-text">
              <span className="rk-chat-cite-source-title">{item.title}</span>
              {item.title.toLowerCase() === item.site.toLowerCase() ? null : (
                <span className="rk-chat-cite-source-site">{item.site}</span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function CitationPill({
  group,
  onOpen,
}: {
  group: CitationGroup;
  onOpen: (url: string) => void;
}) {
  const first = group.items[0];
  if (!first) return null;
  const extra = group.items.length - 1;
  const label = extra > 0 ? `${first.site} +${extra}` : first.site;
  return (
    <Popover>
      <PopoverTrigger className="rk-chat-cite" aria-label={label}>
        <LinkFavicon href={first.url} />
        <span className="rk-chat-cite-label">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-80 gap-0 p-1">
        <SourceList items={group.items} onOpen={onOpen} />
      </PopoverContent>
    </Popover>
  );
}

export function SourcesRow({
  items,
  onOpen,
}: {
  items: readonly SourceItem[];
  onOpen: (url: string) => void;
}) {
  const copy = useMarkdownCopy();
  const label = copy.sourcesCount(items.length);
  return (
    <Popover>
      <PopoverTrigger className="rk-chat-sources" aria-label={label}>
        {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-80 gap-0 p-1">
        <SourceList items={items} onOpen={onOpen} />
      </PopoverContent>
    </Popover>
  );
}
