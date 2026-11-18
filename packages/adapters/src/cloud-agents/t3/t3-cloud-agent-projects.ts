import { z } from "zod";

/** The projects T3 lists, as far as a launch matches against them. */
export const projectsSchema = z.object({
  projects: z.array(
    z.object({
      id: z.string(),
      title: z.string().optional(),
      workspaceRoot: z.string().optional(),
      archivedAt: z.string().nullish(),
      defaultModelSelection: z.record(z.string(), z.unknown()).nullish(),
      repositoryIdentity: z
        .object({ webUrl: z.string().optional(), canonicalKey: z.string().optional() })
        .nullish(),
    }),
  ),
});

export type T3Project = z.infer<typeof projectsSchema>["projects"][number];

export function repositoryKeys(project: T3Project): string[] {
  const identity = project.repositoryIdentity;
  return [identity?.webUrl, identity?.canonicalKey]
    .filter((value): value is string => Boolean(value))
    .map(normalizeRepository);
}

/** What the owner may call a project: its title, repository name or workspace folder. */
export function projectNames(project: T3Project): string[] {
  const last = (value: string) => value.split("/").filter(Boolean).at(-1) ?? "";
  return [
    project.title,
    last(project.workspaceRoot ?? ""),
    ...repositoryKeys(project).flatMap((key) => [last(key), key.split("/").slice(-2).join("/")]),
  ]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
}

/** Titles that fit the failure reason's limit, so a refusal shows the bot what it can choose. */
export function candidateNames(projects: T3Project[]): string {
  const titles: string[] = [];
  let length = 0;
  for (const project of projects) {
    const title = project.title || project.id;
    if (length + title.length > 600) return `Projects: ${titles.join(", ")}, …`;
    titles.push(title);
    length += title.length + 2;
  }
  return titles.length ? `Projects: ${titles.join(", ")}.` : "There are no projects.";
}

export function normalizeRepository(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^(https?:\/\/|git@)/, "")
    .replace(/:/, "/")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}
