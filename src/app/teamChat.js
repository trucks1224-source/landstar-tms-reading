// Teammates' Google Chat settings (TeamChatSettings.jsx). Tested in teamChat.test.js.

// "Name | address" (or just the address) per line -> [{ name, url }].
export function parseChatLines(text) {
  return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line, index) => {
    const url = line.match(/https:\/\/(?:chat|mail)\.google\.com\/\S+/)?.[0] || '';
    const name = line.replace(url, '').replace(/[|,]\s*$/, '').replace(/^\s*[|,]/, '').trim();
    return { name: name || `Chat ${index + 1}`, url };
  });
}
