import { youtubeId } from '@/lib/media';

type Video = {
  id: number;
  title: string;
  description?: string | null;
  url?: string | null;
  content_type?: string | null;
};

export default function DiscussionVideo({ video }: { video: Video }) {
  const url = String(video.url ?? '');
  const youtube = youtubeId(url);
  const isDirectVideo = video.content_type?.startsWith('video/')
    || /\.(?:mp4|webm|mov|m4v|ogv)(?:[?#]|$)/i.test(url);

  return (
    <section className="discussion-video" aria-label="Discussion video">
      <h3>{video.title}</h3>
      {youtube ? (
        <div className="discussion-video-frame">
          <iframe
            src={`https://www.youtube.com/embed/${youtube}`}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            loading="lazy"
          />
        </div>
      ) : isDirectVideo && url ? (
        <div className="discussion-video-frame">
          <video src={url} controls preload="metadata" playsInline />
        </div>
      ) : (
        <a className="btn btn-sm btn-ghost" href={url} target="_blank" rel="noreferrer noopener">
          Watch video ↗
        </a>
      )}
      {video.description && <p>{video.description}</p>}
    </section>
  );
}
