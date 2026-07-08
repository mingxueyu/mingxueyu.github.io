-- 评论区表
CREATE TABLE comments (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_slug TEXT NOT NULL,
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 索引：按文章查评论时按时间排序
CREATE INDEX idx_comments_post_slug ON comments (post_slug, created_at);

-- RLS 策略
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- 任何人可读
CREATE POLICY "评论公开可读" ON comments
  FOR SELECT USING (true);

-- 登录用户可发表
CREATE POLICY "登录用户可发表" ON comments
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 用户可以删除自己的评论
CREATE POLICY "用户可删除自己的评论" ON comments
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
