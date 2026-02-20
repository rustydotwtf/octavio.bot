const GITHUB_API_BASE_URL = "https://api.github.com";
const API_VERSION = "2022-11-28";
const BOT_FINGERPRINT_PREFIX = "<!-- octavio-review:";

export interface RepoRef {
  owner: string;
  pullNumber: number;
  repo: string;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  body: string | null;
  headSha: string;
  baseSha: string;
}

export interface PullRequestFile {
  filename: string;
  status: string;
  patch: string | null;
}

export interface PullRequestReviewComment {
  id: number;
  path: string;
  line: number | null;
  side: "LEFT" | "RIGHT" | null;
  body: string;
  userLogin: string;
}

export interface CreateReviewCommentInput {
  body: string;
  path: string;
  line: number;
  side?: "LEFT" | "RIGHT";
}

interface GithubClientOptions {
  token: string;
}

interface GithubRequestOptions {
  method?: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
}

export class GitHubReviewClient {
  private readonly token: string;

  public constructor(options: GithubClientOptions) {
    this.token = options.token;
  }

  public async getPullRequest(repo: RepoRef): Promise<PullRequestSummary> {
    const response = await this.request<{
      number: number;
      title: string;
      body: string | null;
      head: { sha: string };
      base: { sha: string };
    }>({
      path: `/repos/${repo.owner}/${repo.repo}/pulls/${repo.pullNumber}`,
    });

    return {
      baseSha: response.base.sha,
      body: response.body,
      headSha: response.head.sha,
      number: response.number,
      title: response.title,
    };
  }

  public async listPullRequestFiles(repo: RepoRef): Promise<PullRequestFile[]> {
    const files = await this.paginate<{
      filename: string;
      status: string;
      patch?: string;
    }>(`/repos/${repo.owner}/${repo.repo}/pulls/${repo.pullNumber}/files`);

    return files.map((file) => ({
      filename: file.filename,
      patch: file.patch ?? null,
      status: file.status,
    }));
  }

  public async listReviewComments(
    repo: RepoRef
  ): Promise<PullRequestReviewComment[]> {
    const comments = await this.paginate<{
      id: number;
      path: string;
      line: number | null;
      side: "LEFT" | "RIGHT" | null;
      body: string;
      user: { login: string };
    }>(`/repos/${repo.owner}/${repo.repo}/pulls/${repo.pullNumber}/comments`);

    return comments.map((comment) => ({
      body: comment.body,
      id: comment.id,
      line: comment.line,
      path: comment.path,
      side: comment.side,
      userLogin: comment.user.login,
    }));
  }

  public async createReviewComment(
    repo: RepoRef,
    input: CreateReviewCommentInput,
    commitSha: string
  ): Promise<PullRequestReviewComment> {
    const response = await this.request<{
      id: number;
      path: string;
      line: number | null;
      side: "LEFT" | "RIGHT" | null;
      body: string;
      user: { login: string };
    }>({
      body: {
        body: input.body,
        commit_id: commitSha,
        line: input.line,
        path: input.path,
        side: input.side ?? "RIGHT",
      },
      method: "POST",
      path: `/repos/${repo.owner}/${repo.repo}/pulls/${repo.pullNumber}/comments`,
    });

    return {
      body: response.body,
      id: response.id,
      line: response.line,
      path: response.path,
      side: response.side,
      userLogin: response.user.login,
    };
  }

  public async updateReviewComment(
    repo: RepoRef,
    commentId: number,
    body: string
  ): Promise<PullRequestReviewComment> {
    const response = await this.request<{
      id: number;
      path: string;
      line: number | null;
      side: "LEFT" | "RIGHT" | null;
      body: string;
      user: { login: string };
    }>({
      body: { body },
      method: "PATCH",
      path: `/repos/${repo.owner}/${repo.repo}/pulls/comments/${commentId}`,
    });

    return {
      body: response.body,
      id: response.id,
      line: response.line,
      path: response.path,
      side: response.side,
      userLogin: response.user.login,
    };
  }

  public static buildFingerprintTag(findingId: string): string {
    return `${BOT_FINGERPRINT_PREFIX}${findingId} -->`;
  }

  private async paginate<T>(path: string): Promise<T[]> {
    let page = 1;
    const results: T[] = [];

    while (true) {
      const pageResults = await this.request<T[]>({
        path: `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      });

      if (pageResults.length === 0) {
        return results;
      }

      results.push(...pageResults);
      page += 1;
    }
  }

  private async request<T>(options: GithubRequestOptions): Promise<T> {
    const response = await fetch(`${GITHUB_API_BASE_URL}${options.path}`, {
      body: options.body ? JSON.stringify(options.body) : undefined,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": API_VERSION,
      },
      method: options.method ?? "GET",
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `GitHub API request failed (${response.status}): ${errorText}`
      );
    }

    return (await response.json()) as T;
  }
}
