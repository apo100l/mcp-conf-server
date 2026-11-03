# mcp-conf-server

MCP server for self-hosted Confluence Server / Data Center, based on [mcp-jira-server](https://github.com/apo100l/mcp-jira-server). Uses Confluence REST API and stdio transport. Requires Node.js 22+.

## Install and run

```sh
npm install
npm test
```

Configure your MCP client (replace the absolute path and environment values):

```json
{
  "mcpServers": {
    "confluence": {
      "command": "node",
      "args": ["/absolute/path/mcp-conf-server/build/index.js"],
      "env": {
        "CONFLUENCE_BASE_URL": "https://confluence.example.com",
        "CONFLUENCE_PAT": "your-personal-access-token"
      }
    }
  }
}
```

Include a context path in the base URL when needed, e.g. `https://example.com/confluence`. Cloud API-token authentication is not implemented.

Alternatively set `CONFLUENCE_COOKIE`, or `CONFLUENCE_AUTH_MODE=browser` for SSO through installed Chrome. Call `conf_browser_login`, complete sign-in, then retry. Browser options: `CONFLUENCE_BROWSER_LOGIN_URL`, `CONFLUENCE_BROWSER_PROFILE`, `CONFLUENCE_BROWSER_CHANNEL`. Browser profile defaults to `~/.mcp-conf-server/chrome-profile`; protect it as a credential.

## Tools

- Browser login and authentication status; current user.
- CQL search, list spaces, get space.
- Read, create, update and trash pages; list child pages.
- Read/add comments, read/add labels.

All tool names use the `conf_` prefix. List tools to inspect exact input schemas. Bodies use Confluence storage XHTML. Updates require `currentVersion` obtained from `conf_get_page`; conflicts are surfaced without retry. List/search operations return one page and preserve pagination metadata; use `start` and `limit` for subsequent pages. Server permissions still apply.

## Validation

`npm test` checks TypeScript and builds the executable. Real-instance authentication and write operations require a configured Confluence instance and have not been tested by this project bootstrap.

API reference: https://developer.atlassian.com/server/confluence/rest/latest/

MIT license; retains the upstream license attribution.
