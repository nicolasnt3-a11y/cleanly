/** STUB — propriété de l'agent « IA + paramètres ». */
import type { AiProvider, AiReviewRequest, AiReviewResult, Result, TestApiKeyResult } from '../../../../shared/types';

export async function reviewItems(_req: AiReviewRequest): Promise<Result<AiReviewResult>> {
  return { ok: false, error: 'Non implémenté' };
}
export async function testApiKey(_provider: AiProvider): Promise<TestApiKeyResult> {
  return { ok: false, message: 'Non implémenté' };
}
