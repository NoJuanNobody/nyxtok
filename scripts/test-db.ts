// Integration smoke test for the DB query helpers.
// Run with: DATABASE_URL=... npx tsx scripts/test-db.ts
import {
  upsertVideo,
  getVideo,
  getFeed,
  searchVideos,
  updateVideoStatus,
  db,
} from '../packages/shared/src';

async function main() {
  const now = new Date();
  const v = await upsertVideo({
    video_id: 'test-1',
    creator_handle: 'ai_creator',
    creator_id: 'ucid-1',
    caption: 'Understanding transformer attention',
    hashtags: 'ai;ml;transformers',
    view_count: 1000,
    like_count: 200,
    share_count: 10,
    comment_count: 5,
    duration_seconds: 60,
    ai_relevance_score: 0.92,
    published_at: now,
    tags: 'ai;ml',
  });
  console.log('upsert ok:', v.video_id, 'score=', v.ai_relevance_score);

  // upsert again (update path)
  await upsertVideo({
    video_id: 'test-1',
    creator_handle: 'ai_creator',
    creator_id: 'ucid-1',
    view_count: 1500,
    like_count: 200,
    share_count: 10,
    comment_count: 5,
    duration_seconds: 60,
    ai_relevance_score: 0.95,
    published_at: now,
  });
  const got = await getVideo('test-1');
  console.log('getVideo ok:', got?.video_id, 'views=', got?.view_count, 'score=', got?.ai_relevance_score);

  const updated = await updateVideoStatus('test-1', { user_status: 'liked', is_liked: true });
  console.log('updateStatus ok:', updated.user_status, updated.is_liked);

  // second video for feed/search
  await upsertVideo({
    video_id: 'test-2',
    creator_handle: 'other_creator',
    creator_id: 'ucid-2',
    caption: 'Cooking pasta',
    view_count: 500,
    like_count: 50,
    share_count: 2,
    comment_count: 1,
    duration_seconds: 30,
    ai_relevance_score: 0.3,
    published_at: now,
    tags: 'cooking',
  });

  const feed = await getFeed({ offset: 0, limit: 10, sort: 'ai_relevance_score' });
  console.log('feed ok: total=', feed.total_count, 'first=', feed.videos[0]?.video_id);

  const filtered = await getFeed({
    offset: 0,
    limit: 10,
    sort: 'discovered_at',
    min_relevance: 0.5,
    filter_tags: ['ai'],
  });
  console.log('filtered feed ok: total=', filtered.total_count);

  const search = await searchVideos('transformer');
  console.log('search ok: total=', search.total_count, 'hit=', search.videos[0]?.video_id);

  const byCreator = await searchVideos('', 'other_creator');
  console.log('search by creator ok: total=', byCreator.total_count);

  const missing = await getVideo('does-not-exist');
  console.log('getVideo missing ok:', missing);

  console.log('\nALL TESTS PASSED');
}

main()
  .catch((e) => {
    console.error('TEST FAILED:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end({ timeout: 5 });
  });
