import { Clipboard, showHUD } from "@raycast/api";

export default async function Command() {
  const response = await fetch("https://example.com/greeting");
  await Clipboard.copy(await response.text());
  await showHUD("Copied Greeting");
}
