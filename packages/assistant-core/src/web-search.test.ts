import { afterEach, expect, test } from "bun:test";

import { runWebSearchTool } from "./web-search";

const originalFetch = globalThis.fetch;

const toUrl = (input: URL | Request | string): URL => {
  if (input instanceof URL) {
    return input;
  }

  if (typeof input === "string") {
    return new URL(input);
  }

  return new URL(input.url);
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

const setMockFetch = (
  mock: (input: URL | Request | string, init?: RequestInit) => Promise<Response>
): void => {
  globalThis.fetch = Object.assign(
    async (input: URL | Request | string, init?: RequestInit) => {
      const response = await mock(input, init);
      return response;
    },
    { preconnect: originalFetch.preconnect }
  );
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("uses Brave endpoint, query params, and auth header", async () => {
  setMockFetch(async (input, init) => {
    const url = toUrl(input);
    expect(url.origin).toBe("https://api.search.brave.com");
    expect(url.pathname).toBe("/res/v1/web/search");
    expect(url.searchParams.get("q")).toBe("bun runtime");
    expect(url.searchParams.get("count")).toBe("2");

    const headers = new Headers(init?.headers);
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("X-Subscription-Token")).toBe("test-key");

    await Promise.resolve();
    return Response.json({
      web: {
        results: [
          {
            description: "Bun docs",
            title: "Bun",
            url: "https://bun.sh/docs",
          },
        ],
      },
    });
  });

  const result = await runWebSearchTool(
    {
      limit: 2,
      query: "bun runtime",
    },
    {
      apiKey: "test-key",
    }
  );

  expect(result).toEqual({
    provider: "brave",
    query: "bun runtime",
    results: [
      {
        snippet: "Bun docs",
        title: "Bun",
        url: "https://bun.sh/docs",
      },
    ],
    summary: 'Found 1 search result(s) for "bun runtime".',
  });
});

test("filters invalid results and applies limit", async () => {
  setMockFetch(async () => {
    await Promise.resolve();
    return Response.json({
      web: {
        results: [
          {
            description: "First description",
            title: "First result",
            url: "https://example.com/one",
          },
          {
            description: "Second description",
            url: "https://example.com/two",
          },
          {
            description: "Ignored because no URL",
            title: "Missing URL",
          },
          {
            description: "Third description",
            title: "Third result",
            url: "https://example.com/three",
          },
        ],
      },
    });
  });

  const result = await runWebSearchTool(
    {
      limit: 2,
      query: "anything",
    },
    {
      apiKey: "test-key",
    }
  );

  expect(result.results).toEqual([
    {
      snippet: "First description",
      title: "First result",
      url: "https://example.com/one",
    },
    {
      snippet: "Second description",
      title: "Brave Result",
      url: "https://example.com/two",
    },
  ]);
});

test("throws for non-ok Brave responses", async () => {
  setMockFetch(async () => {
    await Promise.resolve();
    return new Response("rate limited", { status: 429 });
  });

  let caughtError: unknown;

  try {
    await runWebSearchTool(
      {
        limit: 5,
        query: "anything",
      },
      {
        apiKey: "test-key",
      }
    );
  } catch (error) {
    caughtError = error;
  }

  expect(getErrorMessage(caughtError)).toBe(
    "Brave search request failed with status 429."
  );
});

test("throws when Brave API key is missing", async () => {
  let caughtError: unknown;

  try {
    await runWebSearchTool(
      {
        limit: 5,
        query: "anything",
      },
      {
        apiKey: "   ",
      }
    );
  } catch (error) {
    caughtError = error;
  }

  expect(getErrorMessage(caughtError)).toBe(
    "BRAVE_SEARCH_API_KEY is required for web_search."
  );
});
