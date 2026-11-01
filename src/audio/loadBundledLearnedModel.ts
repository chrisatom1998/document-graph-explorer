import learnedIndex from '../../public/sound-model/learned.json';
import { assembleLearnedModel } from './assembleLearnedModel';
import { sanitizeLearnedDjModel, type LearnedDjModel } from './learnedDjModel';

/** The head files are compiled into one module, so this is one request, not one request per head. */
export async function loadBundledLearnedModel(): Promise<LearnedDjModel | undefined> {
  const { linear, neighbours } = await import('virtual:learned-heads');
  return sanitizeLearnedDjModel(assembleLearnedModel(learnedIndex, linear, neighbours));
}
