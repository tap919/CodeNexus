import type { KnowledgeSynthesis } from '../../../shared/src/types';
import type { ModuleAdapters } from '../orchestrator';
import { KnowledgeEngine } from '@codenexus/knowledge-engine';

const engine = new KnowledgeEngine();

export function createDefaultKnowledgeEngine(): ModuleAdapters['knowledgeEngine'] {
  return {
    async search(query: string, maxSources: number): Promise<KnowledgeSynthesis> {
      return engine.synthesize({ maxSources });
    },
  };
}
