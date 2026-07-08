import rss from "@astrojs/rss";
import { getCollection } from "astro:content";

const posts = await getCollection("blog");

export const GET = () =>
  rss({
    title: "我的博客",
    description: "个人博客",
    site: import.meta.env.SITE || "https://your-username.github.io",
    items: posts
      .filter((p) => !p.data.draft)
      .sort((a, b) => b.data.date.getTime() - a.data.date.getTime())
      .map((post) => ({
        title: post.data.title,
        description: post.data.description || "",
        pubDate: post.data.date,
        link: `/blog/${post.id}`,
      })),
  });
