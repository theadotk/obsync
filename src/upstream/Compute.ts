export async function computeGitBlobSha(content: string | ArrayBuffer): Promise<string> {
    let data: Uint8Array;

    if (typeof content === 'string') {
        const encoder = new TextEncoder();
        data = encoder.encode(content);
    } else {
        data = new Uint8Array(content);
    }

    const encoder = new TextEncoder();
    const header = encoder.encode(`blob ${data.length}\0`);

    const combined = new Uint8Array(header.length + data.length);
    combined.set(header);
    combined.set(data, header.length);

    const hashBuffer = await crypto.subtle.digest('SHA-1', combined);

    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
