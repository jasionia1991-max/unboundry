declare module "ali-oss" {
  type ClientOptions = {
    accessKeyId: string;
    accessKeySecret: string;
    authorizationV4?: boolean;
    bucket: string;
    endpoint?: string;
    region: string;
    secure?: boolean;
    timeout?: number;
  };

  type RequestResult = {
    name?: string;
    res?: {
      headers?: Record<string, string | undefined>;
      requestUrls?: string[];
      status?: number;
    };
  };

  export default class OSS {
    constructor(options: ClientOptions);
    delete(name: string, options?: { versionId?: string }): Promise<RequestResult>;
    head(name: string): Promise<RequestResult>;
    put(
      name: string,
      file: string | Buffer | NodeJS.ReadableStream,
      options?: {
        headers?: Record<string, string>;
        mime?: string;
      },
    ): Promise<RequestResult>;
    signatureUrlV4(
      method: "GET" | "PUT",
      expires: number,
      request: {
        headers?: Record<string, string>;
        queries?: Record<string, string>;
      },
      objectName: string,
      additionalHeaders?: string[],
    ): Promise<string>;
  }
}
