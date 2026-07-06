import * as github from "#core/integrations/plugins/github.js";
import { resolveGithub, PROJECT_ARG } from "./_github.js";

export default {
  name: "github_create_issue",
  category: "integrations",
  schema: {
    type: "function",
    function: {
      name: "github_create_issue",
      description: "Open an issue in a GitHub repository.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repo owner (user or org)" },
          repo: { type: "string", description: "Repo name" },
          title: { type: "string", description: "Issue title" },
          body: { type: "string", description: "Issue body (markdown)" },
          ...PROJECT_ARG,
        },
        required: ["owner", "repo", "title"],
      },
    },
  },
  makeHandler: ({ projects }) => async ({ project, owner, repo, title, body } = {}) => {
    const { token } = resolveGithub(projects, project);
    const issue = await github.createIssue(token, { owner, repo, title, body });
    return { issue: { number: issue.number, url: issue.html_url, title: issue.title } };
  },
};
