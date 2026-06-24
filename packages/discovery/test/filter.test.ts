/**
 * Discovery filter tests.
 * Issue #21: viral filter passes/fails based on metrics; AI relevance filter
 * scores AI hashtags >= 0.7; non-AI videos score < 0.3.
 */
import { describe, it, expect } from 'vitest';
import {
  passesViralFilter,
  engagementRate,
  withinGracePeriod,
  DEFAULT_VIRAL_CONFIG,
} from '../src/viral-filter';
import { keywordScore, AI_KEYWORD_WHITELIST } from '../src/ai-filter';
import type { TikTokVideoMeta } from '../src/tiktok-client';

function makeVideo(overrides: Partial<TikTokVideoMeta> = {}): TikTokVideoMeta {
  return {
    video_id: '1',
    creator_handle: 'creator',
    creator_id: '1',
    caption: '',
    hashtags: [],
    view_count: 0,
    like_count: 0,
    share_count: 0,
    comment_count: 0,
    duration_seconds: 30,
    published_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // a week ago
    thumbnail_url: '',
    ...overrides,
  };
}

describe('Viral filter', () => {
  it('passes a video with high view count (>= min_views)', () => {
    const v = makeVideo({ view_count: 200_000 });
    expect(passesViralFilter(v)).toBe(true);
  });

  it('passes a video with high likes AND high engagement rate', () => {
    const v = makeVideo({
      view_count: 50_000,
      like_count: 15_000, // >= min_likes
      comment_count: 500,
      share_count: 500,
    });
    // engagement = (15000 + 500 + 500) / 50000 = 0.32 >= 0.05
    expect(engagementRate(v)).toBeGreaterThanOrEqual(0.05);
    expect(passesViralFilter(v)).toBe(true);
  });

  it('fails a video with low metrics', () => {
    const v = makeVideo({
      view_count: 500,
      like_count: 10,
      comment_count: 1,
      share_count: 1,
    });
    expect(passesViralFilter(v)).toBe(false);
  });

  it('fails a video with high views but very low engagement and below min_likes', () => {
    const v = makeVideo({
      view_count: 80_000, // below min_views (100k)
      like_count: 100, // below min_likes (10k)
      comment_count: 5,
      share_count: 5,
    });
    expect(passesViralFilter(v)).toBe(false);
  });

  it('always passes videos published within the grace period (24h)', () => {
    const v = makeVideo({
      view_count: 10,
      like_count: 0,
      published_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
    });
    expect(withinGracePeriod(v)).toBe(true);
    expect(passesViralFilter(v)).toBe(true);
  });

  it('engagementRate returns 0 when view_count is 0', () => {
    const v = makeVideo({ view_count: 0, like_count: 100 });
    expect(engagementRate(v)).toBe(0);
  });
});

describe('AI relevance filter (keyword score)', () => {
  it('scores AI hashtags >= 0.7 when multiple AI keywords are present', () => {
    const v = makeVideo({
      caption: 'Check out the latest in AI and MachineLearning',
      hashtags: ['AI', 'LLM', 'ChatGPT', 'DeepLearning', 'NLP', 'GenAI', 'PromptEngineering'],
    });
    // 7 matches * 0.1 = 0.7
    const score = keywordScore(v);
    expect(score).toBeGreaterThanOrEqual(0.7);
  });

  it('scores < 0.3 for non-AI videos', () => {
    const v = makeVideo({
      caption: 'Making a delicious pasta recipe at home',
      hashtags: ['cooking', 'recipe', 'pasta', 'food'],
    });
    const score = keywordScore(v);
    expect(score).toBeLessThan(0.3);
  });

  it('scores exactly 0 when no AI keywords are present', () => {
    const v = makeVideo({
      caption: 'My morning routine',
      hashtags: ['morning', 'routine', 'lifestyle'],
    });
    expect(keywordScore(v)).toBe(0);
  });

  it('caps the keyword score at 1.0', () => {
    const v = makeVideo({
      caption: 'AI MachineLearning LLM GenAI AItutorial ChatGPT Midjourney DeepLearning NeuralNetworks ComputerVision NLP TransformerModels PromptEngineering',
      hashtags: [],
    });
    // All 13 keywords match => 1.3, capped at 1.0.
    expect(keywordScore(v)).toBe(1.0);
  });

  it('matches keywords case-insensitively', () => {
    const v = makeVideo({
      caption: 'learning about ai and chatgpt today',
      hashtags: [],
    });
    expect(keywordScore(v)).toBeGreaterThanOrEqual(0.2);
  });

  it('the whitelist includes expected AI terms', () => {
    expect(AI_KEYWORD_WHITELIST).toContain('AI');
    expect(AI_KEYWORD_WHITELIST).toContain('MachineLearning');
    expect(AI_KEYWORD_WHITELIST).toContain('LLM');
    expect(AI_KEYWORD_WHITELIST).toContain('ChatGPT');
  });
});
