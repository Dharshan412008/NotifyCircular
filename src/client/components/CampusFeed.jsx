import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Flag, Heart, ImagePlus, MessageCircle, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest } from '../api.js';
import Modal from './Modal.jsx';

const dateLabel = (value) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const avatar = (name) => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('');
const TOPICS = [
  ['general', 'Campus life'],
  ['achievement', 'Achievements'],
  ['event', 'Events'],
  ['opportunity', 'Opportunities'],
  ['question', 'Questions'],
];
function TopicPicker({ value, onChange, disabled, editing = false }) {
  return <label className="field"><span>{editing ? 'Edit topic' : 'Topic'}</span><select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>{TOPICS.map(([topic, label]) => <option key={topic} value={topic}>{label}</option>)}</select></label>;
}
function ErrorMessage({ error }) {
  return error ? <p className="form-error" role="alert">{error.message || String(error)}</p> : null;
}

function PostCard({ post, user, refresh }) {
  const client = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [comment, setComment] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editCaption, setEditCaption] = useState(post.caption);
  const [editTopic, setEditTopic] = useState(post.topic || 'general');
  const [reportTarget, setReportTarget] = useState(null), [reason, setReason] = useState('');
  const report = useMutation({ mutationFn: () => apiRequest('/api/reports', { method: 'POST', body: { targetType: reportTarget.type, targetId: reportTarget.id, reason } }), onSuccess: () => { setReportTarget(null); setReason(''); } });
  const save = useMutation({
    mutationFn: () => apiRequest(`/api/posts/${post.id}/save`, { method: post.saved ? 'DELETE' : 'PUT' }),
    onSuccess: refresh,
  });
  const edit = useMutation({
    mutationFn: () => apiRequest(`/api/posts/${post.id}`, { method: 'PATCH', body: { caption: editCaption.trim(), topic: editTopic } }),
    onSuccess: async () => { setEditing(false); await refresh(); },
  });
  const commentsKey = ['campus-comments', user.id, post.id];
  const comments = useInfiniteQuery({
    queryKey: commentsKey,
    initialPageParam: null,
    queryFn: ({ pageParam }) => apiRequest(`/api/posts/${post.id}/comments${pageParam ? `?before=${pageParam}` : ''}`),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: expanded,
  });
  const like = useMutation({
    mutationFn: () => apiRequest(`/api/posts/${post.id}/like`, { method: post.liked ? 'DELETE' : 'PUT' }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => apiRequest(`/api/posts/${post.id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  const reply = useMutation({
    mutationFn: () => apiRequest(`/api/posts/${post.id}/comments`, { method: 'POST', body: { text: comment.trim() } }),
    onSuccess: async () => {
      setComment('');
      await Promise.all([refresh(), client.invalidateQueries({ queryKey: commentsKey })]);
    },
  });
  return (
    <article className="campus-post" aria-label={`Post by ${post.authorName}`}>
      <header className="campus-post-header">
        <span className="avatar campus-avatar">{avatar(post.authorName)}</span>
        <div><strong>{post.authorName}</strong><small>{post.authorRole} · <time dateTime={post.createdAt}>{dateLabel(post.createdAt)}</time></small></div>
        {post.authorId === user.id && <button className="icon-button" aria-label="Delete post" onClick={() => setConfirmDelete(true)}><Trash2 /></button>}
        {post.authorId === user.id && <button className="icon-button" aria-label="Edit post" onClick={() => { setEditCaption(post.caption); setEditTopic(post.topic || 'general'); edit.reset(); setEditing(true); }}><Pencil /></button>}
        {post.authorId !== user.id && <button className="icon-button" aria-label="Report post" onClick={() => { report.reset(); setReportTarget({ type: 'post', id: post.id }); }}><Flag /></button>}
      </header>
      {post.hasImage ? <img className="campus-photo" src={`/api/posts/${post.id}/image`} alt={`Campus photo shared by ${post.authorName}`} loading="lazy" /> : null}
      <span className={`campus-topic-badge topic-${post.topic || 'general'}`}>{TOPICS.find(([topic]) => topic === post.topic)?.[1] || 'Campus life'}</span>
      <p className={`campus-caption${post.hasImage ? '' : ' text-post'}`}>{post.caption}</p>
      <div className="campus-post-actions">
        <button className={`inline-button campus-like${post.liked ? ' liked' : ''}`} aria-label={post.liked ? 'Unlike post' : 'Like post'} aria-pressed={Boolean(post.liked)} disabled={like.isPending} onClick={() => like.mutate()}><Heart fill={post.liked ? 'currentColor' : 'none'} /> {post.likeCount} <span>likes</span></button>
        <button className="inline-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><MessageCircle /> {post.commentCount} comments</button>
        <button className="inline-button campus-save" aria-label={post.saved ? 'Unsave post' : 'Save post'} aria-pressed={Boolean(post.saved)} disabled={save.isPending} onClick={() => save.mutate()}><Bookmark fill={post.saved ? 'currentColor' : 'none'} /><span>{post.saved ? 'Saved' : 'Save'}</span></button>
      </div>
      <ErrorMessage error={like.error || remove.error || save.error} />
      {expanded && <section className="campus-comments" aria-label="Comments">
        {comments.isPending && <p role="status">Loading comments...</p>}
        <ErrorMessage error={comments.error} />
        {comments.isError && <button className="inline-button" onClick={() => comments.refetch()}>Retry comments</button>}
        {comments.data?.pages.flatMap((page) => page.comments).map((item) => <div className="campus-comment" key={item.id}><strong>{item.authorName}</strong><p>{item.text}</p><small>{dateLabel(item.createdAt)}</small>{item.authorId !== user.id && <button className="inline-button" onClick={() => { report.reset(); setReportTarget({ type: 'comment', id: item.id }); }}><Flag />Report comment</button>}</div>)}
        {comments.hasNextPage && <button className="inline-button" disabled={comments.isFetchingNextPage} onClick={() => comments.fetchNextPage()}>Older comments</button>}
        <form onSubmit={(event) => { event.preventDefault(); if (comment.trim()) reply.mutate(); }}>
          <label className="field"><span>Add a comment</span><input value={comment} maxLength={500} disabled={reply.isPending} onChange={(event) => setComment(event.target.value)} placeholder="Celebrate or join the conversation..." /></label>
          <button className="secondary-button" disabled={!comment.trim() || reply.isPending}>{reply.isPending ? 'Posting...' : 'Post comment'}</button>
          <ErrorMessage error={reply.error} />
        </form>
      </section>}
      <Modal open={confirmDelete} onClose={() => !remove.isPending && setConfirmDelete(false)} title="Delete this post?" eyebrow="Your campus post">
        <p>This also removes its photo, likes, and comments.</p>
        <ErrorMessage error={remove.error} />
        <button className="primary-button" disabled={remove.isPending} onClick={() => remove.mutate()}>{remove.isPending ? 'Deleting...' : 'Delete permanently'}</button>
      </Modal>
      <Modal open={editing} dismissible={!edit.isPending} onClose={() => setEditing(false)} title="Edit your post" eyebrow="Keep your campus updated">
        <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (editCaption.trim()) edit.mutate(); }}>
          <TopicPicker value={editTopic} onChange={setEditTopic} disabled={edit.isPending} editing />
          <label className="field"><span>Edit caption</span><textarea rows={5} value={editCaption} maxLength={2000} required disabled={edit.isPending} onChange={(event) => setEditCaption(event.target.value)} /></label>
          <ErrorMessage error={edit.error} />
          <button className="primary-button" disabled={!editCaption.trim() || edit.isPending}>{edit.isPending ? 'Saving...' : 'Save changes'}</button>
        </form>
      </Modal>
      {report.isSuccess && <p className="form-success" role="status">Report received. Your college moderators will review it.</p>}
      <Modal open={Boolean(reportTarget)} dismissible={!report.isPending} onClose={() => setReportTarget(null)} title="Report to your college" eyebrow="Private moderator review"><form className="form-stack" onSubmit={(event) => { event.preventDefault(); report.mutate(); }}><label className="field"><span>What should the moderator know?</span><textarea rows={4} required minLength={5} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label><ErrorMessage error={report.error} /><button className="primary-button" disabled={report.isPending}>{report.isPending ? 'Submitting…' : 'Submit report'}</button></form></Modal>
    </article>
  );
}

export default function CampusFeed({ user }) {
  const [params, setParams] = useSearchParams();
  const exactPost = params.get('post');
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [caption, setCaption] = useState('');
  const [topic, setTopic] = useState('general');
  const [photo, setPhoto] = useState(null);
  const [photoError, setPhotoError] = useState(null);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const photoSequence = useRef(0);
  const [posted, setPosted] = useState(false);
  const search = params.get('q') ?? params.get('author') ?? '';
  const view = ['saved', 'mine'].includes(params.get('view')) ? params.get('view') : 'all';
  const topicFilter = TOPICS.some(([value]) => value === params.get('topic')) ? params.get('topic') : 'all';
  const [debouncedSearch, setDebouncedSearch] = useState(search.trim());
  const changeFilter = (key, value) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (key === 'q') next.delete('author');
    if (!value || value === 'all') next.delete(key); else next.set(key, value);
    return next;
  }, { replace: true });
  const setSearch = (value) => changeFilter('q', value);
  const setView = (value) => changeFilter('view', value);
  const setTopicFilter = (value) => changeFilter('topic', value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const feed = useInfiniteQuery({
    queryKey: ['campus-feed', user.id, debouncedSearch, view, topicFilter, exactPost],
    initialPageParam: null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ q: debouncedSearch, view, topic: topicFilter });
      if (pageParam) params.set('before', pageParam);
      if (exactPost) params.set('post', exactPost);
      return apiRequest(`/api/posts?${params}`, { signal });
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['campus-feed'] });
  const publish = useMutation({
    mutationFn: () => apiRequest('/api/posts', { method: 'POST', body: { caption: caption.trim(), topic, image: photo } }),
    onSuccess: async () => { setOpen(false); setCaption(''); setTopic('general'); setPhoto(null); setPosted(true); setParams({}, { replace: true }); setDebouncedSearch(''); await refresh(); },
  });
  function selectPhoto(event) {
    const file = event.target.files?.[0];
    const sequence = ++photoSequence.current;
    setPhotoError(null);
    setPhoto(null);
    setReadingPhoto(false);
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setPhotoError('Choose a JPEG, PNG, or WebP photo smaller than 2 MB.');
      event.target.value = '';
      return;
    }
    setReadingPhoto(true);
    const reader = new FileReader();
    reader.onload = () => { if (sequence === photoSequence.current) { setPhoto(reader.result); setReadingPhoto(false); } };
    reader.onerror = () => { if (sequence === photoSequence.current) { setPhotoError('Could not read this photo. Try another file.'); setReadingPhoto(false); } };
    reader.readAsDataURL(file);
  }
  const posts = feed.data?.pages.flatMap((page) => page.posts) || [];
  return (
    <section className="tab-view campus-feed" aria-labelledby="campus-heading">
      <div className="section-heading"><div><p className="overline">Made by our campus</p><h3 id="campus-heading">Campus feed</h3></div><button className="icon-button" aria-label="Refresh campus feed" disabled={feed.isFetching} onClick={refresh}><RefreshCw /></button></div>
      <p className="view-intro">Big wins, everyday moments, and ideas worth sharing. A space for everyone at college.</p>
      {exactPost && <button className="secondary-button" onClick={() => setParams({})}>Back to all posts</button>}
      <button className="campus-compose" onClick={() => { setPosted(false); publish.reset(); setOpen(true); }}><span className="avatar campus-avatar">{avatar(user.name)}</span><span>Share something with campus<small>Updates, achievements & college life</small></span><Plus /></button>
      <div className="feed-discovery">
        <label className="discovery-search"><Search aria-hidden="true" /><span className="sr-only">Search campus posts</span><input type="search" maxLength={100} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search posts or people..." /></label>
        <div className="filter-row feed-filters" aria-label="Campus feed filters">
          {[['all', 'Explore'], ['saved', 'Saved'], ['mine', 'My posts']].map(([value, label]) => <button key={value} className={view === value ? 'active' : ''} aria-pressed={view === value} onClick={() => setView(value)}>{value === 'saved' && <Bookmark aria-hidden="true" />}{label}</button>)}
        </div>
        <div className="filter-row campus-topics" aria-label="Campus topics">
          {[['all', 'All topics'], ...TOPICS].map(([value, label]) => <button key={value} className={topicFilter === value ? 'active' : ''} aria-pressed={topicFilter === value} onClick={() => setTopicFilter(value)}>{label}</button>)}
        </div>
      </div>
      {(search || view !== 'all' || topicFilter !== 'all') && <div className="filter-summary"><p>Filters apply across all campus posts.</p><button className="inline-button" onClick={() => { setParams({}, { replace: true }); setDebouncedSearch(''); }}>Reset filters</button></div>}
      {view === 'saved' && <p className="collection-note">Your private collection. Only you can see what you save.</p>}
      {posted && <p className="auth-security" role="status">Your post is now visible to everyone on campus.</p>}
      {feed.isPending && <p role="status">Loading campus posts...</p>}
      <ErrorMessage error={feed.error} />
      {feed.isError && <button className="secondary-button" onClick={() => feed.refetch()}>Try again</button>}
      {feed.isSuccess && !posts.length && <div className="empty-state"><span className="empty-icon">{view === 'saved' ? <Bookmark /> : <Search />}</span><h4>{debouncedSearch || topicFilter !== 'all' ? 'No matching posts' : view === 'saved' ? 'Keep the good finds.' : view === 'mine' ? 'Your story starts here.' : 'Every campus has a story.'}</h4><p>{debouncedSearch || topicFilter !== 'all' ? 'Try a different topic or a few different words.' : view === 'saved' ? 'Tap Save on any post to come back to it later.' : 'Share an achievement, event, or moment from your college.'}</p>{debouncedSearch && <button className="secondary-button" onClick={() => { setSearch(''); setDebouncedSearch(''); }}>Clear search</button>}{topicFilter !== 'all' && <button className="secondary-button" onClick={() => setTopicFilter('all')}>Show all topics</button>}</div>}
      <div className="campus-post-list">{posts.map((post) => <PostCard key={post.id} post={post} user={user} refresh={refresh} />)}</div>
      {feed.hasNextPage && <button className="secondary-button" disabled={feed.isFetchingNextPage} onClick={() => feed.fetchNextPage()}>{feed.isFetchingNextPage ? 'Loading...' : 'Load more posts'}</button>}
      <Modal open={open} onClose={() => !publish.isPending && setOpen(false)} eyebrow="Visible to all students and faculty" title="Create a campus post">
        <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (caption.trim() && !readingPhoto) publish.mutate(); }}>
          <TopicPicker value={topic} onChange={setTopic} disabled={publish.isPending} />
          <label className="field"><span>Caption</span><textarea required maxLength={2000} rows={5} value={caption} disabled={publish.isPending} onChange={(event) => setCaption(event.target.value)} placeholder="A team win? A new project? A moment from campus?" /></label>
          <label className="field campus-upload"><span><ImagePlus /> Add a photo (optional)</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={publish.isPending} onChange={selectPhoto} /><small>JPEG, PNG, or WebP · up to 2 MB</small></label>
          {readingPhoto && <p role="status">Preparing photo...</p>}
          {photo && <div className="campus-preview"><img src={photo} alt="Photo preview" /><button type="button" className="icon-button" aria-label="Remove photo" disabled={publish.isPending} onClick={() => { setPhoto(null); ++photoSequence.current; }}><X /></button></div>}
          <ErrorMessage error={photoError || publish.error} />
          <button className="primary-button" disabled={!caption.trim() || publish.isPending || readingPhoto}>{publish.isPending ? 'Sharing...' : 'Share post'}</button>
        </form>
      </Modal>
    </section>
  );
}
