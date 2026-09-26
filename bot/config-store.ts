// One vendor's vendor.json + catalog.json: load, validate, save, hot-reload.
// Backends: JSON files (local, keyless) or a Supabase row (deployed). Each snapshot is
// immutable: a save swaps in a new object, so a /quote that grabbed the old snapshot
// finishes on consistent data.
import { existsSync, readFileSync, watch } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { live } from "../lib/config";
import { CatalogSchema, CategorySchema, VendorSchema, validateVendorCatalog, type Catalog, type Category, type Vendor } from "./schema";

export const VENDORS_DIR = new URL("../vendors/", import.meta.url).pathname;

export type Snapshot = Readonly<{ vendor: Vendor; catalog: Catalog; categories: Category[]; version: number }>;
export type Raw = { vendor: unknown; catalog: unknown; version: number };

export class ConfigError extends Error {
  constructor(public problems: string[]) {
    super(problems.join(" "));
  }
}
export class ConflictError extends Error {
  constructor() {
    super("Someone else saved this vendor since you loaded it. Reload and try again.");
  }
}

export interface Backend {
  kind: "file" | "supabase";
  load(): Promise<Raw>;
  /** Persist; must fail with ConflictError if the stored version isn't `expected`. Returns the new version. */
  save(next: { vendor: Vendor; catalog: Catalog }, expected: number, by: string): Promise<number>;
  /** Call `onChange` with fresh data whenever the stored config changes outside this process. */
  watch(onChange: (raw: Raw) => void, log: (msg: string) => void): void;
}

const readJSON = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const serialise = (data: unknown) => JSON.stringify(data, null, 2) + "\n";

export function listVendorIds(): string[] {
  const all = readJSON(join(VENDORS_DIR, "index.json")) as string[];
  return all.filter((id) => existsSync(join(VENDORS_DIR, id, "vendor.json")));
}

/** The repo's JSON for a vendor - the file backend's data and the Supabase seed. */
export function seedFiles(id: string) {
  const dir = join(VENDORS_DIR, id);
  if (!existsSync(join(dir, "vendor.json"))) throw new Error(`No vendor config at ${dir}/vendor.json`);
  return { vendor: readJSON(join(dir, "vendor.json")), catalog: readJSON(join(dir, "catalog.json")) };
}

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new ConfigError(r.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`));
  return r.data;
}

let categoriesCache: Category[] | null = null;
const categories = () => (categoriesCache ??= parse(z.array(CategorySchema), readJSON(join(VENDORS_DIR, "categories.json"))));

function build(vendor: unknown, catalog: unknown, version: number): Snapshot {
  const v = parse(VendorSchema, vendor);
  const c = parse(CatalogSchema, catalog);
  const cats = categories();
  const problems = validateVendorCatalog(v, c, cats.map((k) => k.id));
  if (problems.length) throw new ConfigError(problems);
  return Object.freeze({ vendor: v, catalog: c, categories: cats, version });
}

/* ------------------------------------------------------------------ */
/* File backend                                                         */
/* ------------------------------------------------------------------ */
class FileBackend implements Backend {
  kind = "file" as const;
  private version = 1;
  private last = ""; // file contents we last loaded or wrote, so the watcher skips our own saves
  constructor(private id: string) {}
  private paths() {
    const dir = join(VENDORS_DIR, this.id);
    return { vendor: join(dir, "vendor.json"), catalog: join(dir, "catalog.json") };
  }
  private text() {
    const p = this.paths();
    return readFileSync(p.vendor, "utf8") + readFileSync(p.catalog, "utf8");
  }
  async load(): Promise<Raw> {
    this.last = this.text();
    return { ...seedFiles(this.id), version: this.version };
  }
  async save(next: { vendor: Vendor; catalog: Catalog }, expected: number): Promise<number> {
    if (expected !== this.version) throw new ConflictError();
    const p = this.paths();
    for (const [path, data] of [[p.vendor, next.vendor], [p.catalog, next.catalog]] as const) {
      if (readFileSync(path, "utf8") === serialise(data)) continue; // unchanged
      await writeFile(`${path}.tmp`, serialise(data));
      await rename(`${path}.tmp`, path);
    }
    this.last = this.text();
    return ++this.version;
  }
  watch(onChange: (raw: Raw) => void, log: (msg: string) => void) {
    let timer: NodeJS.Timeout | undefined;
    const reload = () => {
      try {
        const text = this.text();
        if (text === this.last) return;
        this.last = text;
        onChange({ ...seedFiles(this.id), version: ++this.version });
      } catch (e) {
        log(`ignoring invalid config edit: ${(e as Error).message}`);
      }
    };
    watch(join(VENDORS_DIR, this.id), (_ev, file) => {
      if (!file || !file.endsWith(".json")) return;
      clearTimeout(timer);
      timer = setTimeout(reload, 150);
    });
  }
}

/* ------------------------------------------------------------------ */
/* The store                                                            */
/* ------------------------------------------------------------------ */
export class VendorStore {
  private snap!: Snapshot;
  private constructor(
    readonly id: string,
    private backend: Backend,
  ) {}

  get storage() {
    return this.backend.kind;
  }

  static async open(id: string, log: (msg: string) => void): Promise<VendorStore> {
    const backend: Backend = live.supabaseStorage() ? new (await import("./store-supabase")).SupabaseBackend(id, log) : new FileBackend(id);
    const store = new VendorStore(id, backend);
    const raw = await backend.load();
    store.snap = build(raw.vendor, raw.catalog, raw.version);
    backend.watch((r) => {
      if (r.version <= store.snap.version) return; // stale, or our own save echoing back
      try {
        store.snap = build(r.vendor, r.catalog, r.version);
        log(`config reloaded from ${backend.kind} (v${r.version})`);
      } catch (e) {
        log(`ignoring invalid config from ${backend.kind}: ${(e as Error).message}`);
      }
    }, log);
    return store;
  }

  current(): Snapshot {
    return this.snap;
  }

  /** Validate the whole vendor+catalog pair, persist it, then swap the snapshot in. */
  async save(next: { vendor?: unknown; catalog?: unknown }, by = "owner"): Promise<Snapshot> {
    const cur = this.snap;
    const built = build(next.vendor ?? cur.vendor, next.catalog ?? cur.catalog, cur.version);
    const version = await this.backend.save({ vendor: built.vendor, catalog: built.catalog }, cur.version, by);
    this.snap = Object.freeze({ ...built, version });
    return this.snap;
  }
}
