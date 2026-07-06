import * as github from "#core/integrations/plugins/github.js";
import { resolveGithub, PROJECT_ARG } from "./_github.js";

export default {
  name: "github_list_repos",
  category: "integrations",
  schema: {
    type: "function",
    function: {
      name: "github_list_repos",
      description: "List GitHub repositories accessible to the connected token.",
      parameters: { type: "object", properties: { ...PROJECT_ARG } },
    },
  },
  makeHandler: ({ projects }) => async ({ project } = {}) => {
    const { token } = resolveGithub(projects, project);
    const repos = await github.listRepos(token);
    return { repos: repos.map((r) => ({ full_name: r.full_name, private: r.private, url: r.html_url, description: r.description })) };
  },
};
