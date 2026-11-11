window.__fetches = [];
window.__apiHandlers = {};        // tests set: url fragment -> async (body) => [status, json]
export const api = {
  async fetchApi(url, opts) {
    window.__fetches.push([url, opts]);
    for (const [frag, fn] of Object.entries(window.__apiHandlers)) {
      if (url.includes(frag)) {
        const [status, j] = await fn(opts?.body ? JSON.parse(opts.body) : null);
        return { ok: status < 400, status, json: async () => j };
      }
    }
    return { ok: true, status: 200, json: async () => (url.includes("/models/loras") ? ["a.safetensors", "edit.safetensors"] : {}) };
  },
  apiURL: (u) => u, async getExtensions() { return []; }, async getUserData() { return { status: 404 }; },
  async storeUserData() {}, async getSettings() { return {}; }, fileURL: (u) => u,
};
