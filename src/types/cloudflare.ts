export type D1Result<T> = {
  results?: T[];
  success?: boolean;
};

export type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  all: <T>() => Promise<D1Result<T>>;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
};

export type D1DatabaseBinding = {
  prepare: (query: string) => D1PreparedStatement;
  batch: (statements: D1PreparedStatement[]) => Promise<unknown[]>;
};

export type R2ObjectBody = {
  body: ReadableStream;
  httpEtag: string;
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
  };
};

export type R2BucketBinding = {
  get: (key: string) => Promise<R2ObjectBody | null>;
  put: (
    key: string,
    value: ArrayBuffer,
    options?: {
      httpMetadata?: {
        contentType?: string;
        cacheControl?: string;
      };
    },
  ) => Promise<unknown>;
  delete: (key: string) => Promise<void>;
};

export type KomoBasketCloudflareEnv = {
  NEWS_DB?: D1DatabaseBinding;
  NEWS_IMAGES?: R2BucketBinding;
  ADMIN_EMAIL?: string;

  FACEBOOK_PAGE_ID?: string;
  FACEBOOK_ACCESS_TOKEN?: string;
  FACEBOOK_GRAPH_VERSION?: string;
  KOMOBASKET_PUBLIC_URL?: string;
};