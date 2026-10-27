export function workspaceNeedsFlow(contentWidth, workspaceHeight) {
  // Leave room for the filter rail, a readable chart and the compact table.
  return contentWidth < 940 || workspaceHeight < 600;
}
