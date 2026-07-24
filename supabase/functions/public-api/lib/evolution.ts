function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export async function sendEvolutionText(number: string, text: string) {
  const apiUrl = Deno.env.get('EVOLUTION_API_URL')?.trim();
  const apiKey = Deno.env.get('EVOLUTION_API_KEY')?.trim();
  const instance = Deno.env.get('EVOLUTION_INSTANCE')?.trim();

  if (!apiUrl || !apiKey || !instance) {
    throw new Error('EVOLUTION_ENV_MISSING');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(joinUrl(apiUrl, `/message/sendText/${encodeURIComponent(instance)}`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify({ number, text }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`EVOLUTION_HTTP_${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
