import { describe, expect, it } from "vitest";
import assistantChatSource from "./AssistantChat.astro?raw";

describe("AssistantChat lifecycle controls", () => {
	it("has an explicit end action that posts the current session to the chat end API", () => {
		expect(assistantChatSource).toContain("data-chat-end");
		expect(assistantChatSource).toContain('fetch("/api/chat/end"');
		expect(assistantChatSource).toContain('endButton.addEventListener("click"');
	});

	it("does not use browser unload events as the durable chat ending path", () => {
		expect(assistantChatSource).not.toMatch(
			/beforeunload|pagehide|sendBeacon|keepalive/,
		);
	});
});
