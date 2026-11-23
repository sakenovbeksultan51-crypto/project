// Read text first: Safari reports an unhelpful SyntaxError for empty/HTML JSON.
export async function readCameraResponse(response: Response): Promise<Record<string, any>> {
  const text = await response.text();
  let data: Record<string, any>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    data = parsed as Record<string, any>;
  } catch {
    throw new Error(`Сервер камеры вернул некорректный ответ (HTTP ${response.status}). Обновите страницу и попробуйте снова.`);
  }
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `Сервис камеры недоступен (HTTP ${response.status}).`);
  }
  return data;
}
