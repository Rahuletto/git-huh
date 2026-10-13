import { z } from 'zod';

/**
 * Where an idea is on its way to being a project. `next` is the short list —
 * the one or two you mean to start — and `parked` is put away, not deleted.
 */
export const STAGES = ['idea', 'next', 'building', 'shipped', 'parked'] as const;
export type Stage = (typeof STAGES)[number];

const stepSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(1),
  done: z.boolean(),
});

const ideaSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(1),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  stage: z.enum(STAGES),
  steps: z.array(stepSchema),
  /** The repository it became, `owner/name`, once there is one. */
  repo: z.string().nullable(),
});

const v1Schema = z.object({
  version: z.literal(1),
  ideas: z.array(z.object({ id: z.string().min(1), text: z.string().trim().min(1), createdAt: z.number().finite() })),
});
const notebookSchema = z.object({ version: z.literal(2), ideas: z.array(ideaSchema) });

export type ProjectIdea = z.infer<typeof ideaSchema>;
export type IdeaStep = z.infer<typeof stepSchema>;

export interface IdeaStorage {
  read: () => Promise<string | null>;
  write: (raw: string) => Promise<void>;
}

/** These are original notes, not a cache: failures must reach the editor. */
export function createIdeasStore(storage: IdeaStorage) {
  return {
    async load(): Promise<ProjectIdea[]> {
      const raw = await storage.read();
      if (raw === null) return [];
      const parsed: unknown = JSON.parse(raw);
      // A notebook from before stages and steps: every note is an idea.
      const old = v1Schema.safeParse(parsed);
      if (old.success) {
        return old.data.ideas.map((idea) => ({
          ...idea,
          updatedAt: idea.createdAt,
          stage: 'idea' as const,
          steps: [],
          repo: null,
        }));
      }
      return notebookSchema.parse(parsed).ideas;
    },
    async save(ideas: ProjectIdea[]): Promise<void> {
      const notebook = notebookSchema.parse({ version: 2, ideas });
      await storage.write(JSON.stringify(notebook));
    },
  };
}

/** A fresh idea from what was typed: the first line is its name. */
export function newIdea(text: string, now: number, stage: Stage = 'idea'): ProjectIdea {
  return {
    id: `${now}-${Math.random().toString(36).slice(2)}`,
    text: text.trim(),
    createdAt: now,
    updatedAt: now,
    stage,
    steps: [],
    repo: null,
  };
}

/** The name and the rest: an idea is written as a note, its first line the title. */
export function splitIdea(text: string): { title: string; notes: string } {
  const [first, ...rest] = text.trim().split('\n');
  return { title: first.trim(), notes: rest.join('\n').trim() };
}

/**
 * The notebook in reading order: what you are building, then the short list,
 * then the ideas, then what shipped, then what is parked — each newest-touched
 * first.
 */
export function ordered(ideas: readonly ProjectIdea[]): ProjectIdea[] {
  const rank: Record<Stage, number> = { building: 0, next: 1, idea: 2, shipped: 3, parked: 4 };
  return [...ideas].sort((a, b) => rank[a.stage] - rank[b.stage] || b.updatedAt - a.updatedAt);
}

export function counts(ideas: readonly ProjectIdea[]): Record<Stage | 'all', number> {
  const out = { all: ideas.length, idea: 0, next: 0, building: 0, shipped: 0, parked: 0 };
  for (const idea of ideas) out[idea.stage]++;
  return out;
}

/** `3 of 5`, or nothing when there are no steps. */
export function progress(idea: Pick<ProjectIdea, 'steps'>): { done: number; total: number } {
  return { done: idea.steps.filter((step) => step.done).length, total: idea.steps.length };
}

/** A repository name from an idea's title: lower case, dashes, nothing GitHub refuses. */
export function repoName(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/^[-.]+|[-.]+$/g, '');
}

/** One idea changed by `change`, touched now; the rest as they were. */
export function update(
  ideas: readonly ProjectIdea[],
  id: string,
  change: (idea: ProjectIdea) => Partial<ProjectIdea>,
  now: number,
): ProjectIdea[] {
  return ideas.map((idea) => (idea.id === id ? { ...idea, ...change(idea), updatedAt: now } : idea));
}
