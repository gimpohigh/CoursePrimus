export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function providerError(error) {
  const status = Number(error?.status || error?.statusCode || error?.httpStatus);
  const code = String(error?.code || error?.internalCode || '');
  const detail = String(error?.message || '');
  if (status === 429 || ['3036', '3040', '4006', '4007'].includes(code) || /\b(3036|3040|4006|4007)\b/.test(detail)) {
    return new ApiError(429, 'ai-capacity', '오늘의 무료 AI 한도 또는 현재 처리 용량에 도달했습니다. 나중에 다시 시도해주세요.');
  }
  if (status === 408 || error?.name === 'TimeoutError' || /\b3007\b/.test(detail)) {
    return new ApiError(504, 'ai-timeout', 'AI 답변을 기다리는 시간이 길어졌습니다. 잠시 후 다시 시도해주세요.');
  }
  return new ApiError(503, 'ai-unavailable', '무료 AI 서버가 현재 응답하지 못했습니다. 잠시 후 다시 시도해주세요.');
}
