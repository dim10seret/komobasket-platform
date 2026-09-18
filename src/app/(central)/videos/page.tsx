import Header from "@/components/layout/Header";

type Playlist = {
  id: string;
  title: string;
};

const seasonPlaylists: { season: string; playlists: Playlist[] }[] = [
  {
    season: "2025-26",
    playlists: [{ id: "PLLbcYIMoKB8pJky4PISwGg5scbNkb2Vcx", title: "Αγώνες σεζόν 2025-26" }],
  },
  {
    season: "2024-25",
    playlists: [
      { id: "PLLbcYIMoKB8qk4J2og9ub1jvZTOJDtBZJ", title: "Αγώνες σεζόν 2024-25 - Μέρος 1" },
      { id: "PLLbcYIMoKB8qZ7ezJpJJyXbjoI6kQB94A", title: "Αγώνες σεζόν 2024-25 - Μέρος 2" },
      { id: "PLLbcYIMoKB8rsMWDYi_CXETQ8-hE1T4n2", title: "Αγώνες σεζόν 2024-25 - Μέρος 3" },
    ],
  },
  {
    season: "2023-24",
    playlists: [{ id: "PLLbcYIMoKB8oUKvMpTg1-VmyDz_5fb3lo", title: "Αγώνες σεζόν 2023-24" }],
  },
  {
    season: "2022-23",
    playlists: [{ id: "PLLbcYIMoKB8pOKeJwGT9D4j-s9QYJfJHd", title: "Αγώνες σεζόν 2022-23" }],
  },
];

const voicesPlaylist: Playlist = {
  id: "PLLbcYIMoKB8qwgmnw0rQk-S8APp3XejXJ",
  title: "Άνθρωποι του αθλητισμού μιλούν για το KomoBasket",
};

function PlaylistCard({ playlist }: { playlist: Playlist }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg">
      <div className="aspect-video bg-black">
        <iframe
          className="h-full w-full"
          src={`https://www.youtube.com/embed/videoseries?list=${playlist.id}`}
          title={playlist.title}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
      <div className="p-5">
        <h3 className="text-lg font-black text-zinc-900">{playlist.title}</h3>
        <a
          href={`https://www.youtube.com/playlist?list=${playlist.id}`}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex text-sm font-bold text-orange-600 hover:text-orange-700"
        >
          Προβολή στο YouTube
        </a>
      </div>
    </article>
  );
}

export default function VideosPage() {
  return (
    <>
      <Header />
      <main className="bg-zinc-100 pb-20">
        <section className="bg-zinc-950 py-20 text-white">
          <div className="mx-auto max-w-7xl px-6 text-center">
            <p className="font-bold uppercase tracking-[0.2em] text-orange-500">KomoBasket TV</p>
            <h1 className="mt-4 text-5xl font-black">Βίντεο αγώνων</h1>
            <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-zinc-300">
              Δείτε συγκεντρωμένους τους αγώνες του KomoBasket ανά αγωνιστική περίοδο.
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-7xl space-y-16 px-6 py-16">
          {seasonPlaylists.map(({ season, playlists }) => (
            <section key={season}>
              <div className="mb-7 flex items-center gap-4">
                <h2 className="text-3xl font-black text-zinc-900">Σεζόν {season}</h2>
                <div className="h-px flex-1 bg-zinc-300" />
              </div>
              <div className={`grid gap-8 ${playlists.length > 1 ? "lg:grid-cols-3" : "max-w-3xl"}`}>
                {playlists.map((playlist) => <PlaylistCard key={playlist.id} playlist={playlist} />)}
              </div>
            </section>
          ))}

          <section className="rounded-3xl bg-orange-50 p-6 md:p-10">
            <p className="font-bold uppercase tracking-[0.18em] text-orange-600">Ιστορίες του KomoBasket</p>
            <h2 className="mt-3 text-3xl font-black text-zinc-900">Άνθρωποι του αθλητισμού μιλούν για το KomoBasket</h2>
            <p className="mt-4 max-w-3xl leading-7 text-zinc-600">
              Πρόσωπα από τον αθλητισμό της πόλης και ολόκληρης της Ελλάδας μοιράζονται τη δική τους ματιά για το KomoBasket.
            </p>
            <div className="mt-8 max-w-3xl">
              <PlaylistCard playlist={voicesPlaylist} />
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
