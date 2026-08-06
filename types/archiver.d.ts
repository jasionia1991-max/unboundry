declare module "archiver" {
  import type { Transform } from "node:stream";

  interface ZipArchiveOptions {
    zlib?: { level?: number };
  }

  interface EntryData {
    name: string;
  }

  class ZipArchive extends Transform {
    constructor(options?: ZipArchiveOptions);
    append(
      source: string | Buffer | NodeJS.ReadableStream,
      data: EntryData,
    ): ZipArchive;
    file(path: string, data: EntryData): ZipArchive;
    finalize(): Promise<void>;
  }

  export { ZipArchive };
}
