import { arrayBufferToBase64, base64ToArrayBuffer } from "obsidian";

export function base64ToUtf8(base64content: string): string {
    const buffer = base64ToArrayBuffer(base64content);
    return new TextDecoder().decode(buffer);
}

export function utf8ToBase64(text: string): string {
    const encoder = new TextEncoder();
    const buffer = encoder.encode(text);
    return arrayBufferToBase64(buffer);
}

