import { webSearchInput } from "./types";
import type { WebSearchInput } from "./types";

const BRAVE_WEB_SEARCH_ENDPOINT =
  "https://api.search.brave.com/res/v1/web/search";

interface BraveWebResult {
  description?: string;
  title?: string;
  url?: string;
}

interface BraveResponse {
  web?: {
    results?: BraveWebResult[];
  };
}

interface WebSearchResult {
  snippet: string;
  title: string;
  url: string;
}

interface RunWebSearchToolOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toBraveWebResult = (value: unknown): BraveWebResult | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const { description, title, url } = value;

  return {
    description: typeof description === "string" ? description : undefined,
    title: typeof title === "string" ? title : undefined,
    url: typeof url === "string" ? url : undefined,
  };
};

const toBraveResponse = (value: unknown): BraveResponse => {
  if (!isRecord(value)) {
    return {};
  }

  const { web } = value;

  return {
    web: isRecord(web)
      ? {
          results: Array.isArray(web.results)
            ? web.results
                .map(toBraveWebResult)
                .filter((item) => item !== undefined)
            : undefined,
        }
      : undefined,
  };
};

const toWebSearchResult = (
  value: BraveWebResult
): WebSearchResult | undefined => {
  if (typeof value.url !== "string" || value.url.trim().length === 0) {
    return undefined;
  }

  return {
    snippet: typeof value.description === "string" ? value.description : "",
    title:
      typeof value.title === "string" && value.title.trim().length > 0
        ? value.title
        : "Brave Result",
    url: value.url,
  };
};

export const runWebSearchTool = async (
  input: WebSearchInput,
  options?: RunWebSearchToolOptions
): Promise<{
  provider: string;
  query: string;
  results: WebSearchResult[];
  summary: string;
}> => {
  const parsed = webSearchInput.parse(input);
  const apiKey = options?.apiKey ?? process.env.BRAVE_SEARCH_API_KEY ?? "";

  if (apiKey.trim().length === 0) {
    throw new Error("BRAVE_SEARCH_API_KEY is required for web_search.");
  }

  const endpoint = new URL(BRAVE_WEB_SEARCH_ENDPOINT);
  endpoint.searchParams.set("q", parsed.query);
  endpoint.searchParams.set("count", String(parsed.limit));

  const fetchImpl = options?.fetchImpl ?? fetch;
  const response = await fetchImpl(endpoint, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Brave search request failed with status ${response.status}.`
    );
  }

  const payload = toBraveResponse(await response.json());
  const results = (payload.web?.results ?? [])
    .map(toWebSearchResult)
    .filter((item) => item !== undefined)
    .slice(0, parsed.limit);

  return {
    provider: "brave",
    query: parsed.query,
    results,
    summary: `Found ${results.length} search result(s) for "${parsed.query}".`,
  };
};
