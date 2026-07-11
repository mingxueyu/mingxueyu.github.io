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

-- 登录用户可发表（body 限制 5000 字防滥用）
CREATE POLICY "登录用户可发表" ON comments
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND length(body) > 0 AND length(body) <= 5000);

-- 用户可以删除自己的评论
CREATE POLICY "用户可删除自己的评论" ON comments
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- 留言板表（无需登录，可自定义昵称；通过 delete_token 实现作者删除）
CREATE TABLE guestbook (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nickname     TEXT NOT NULL DEFAULT '匿名',
  body         TEXT NOT NULL,
  delete_token TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_guestbook_created_at ON guestbook (created_at DESC);

ALTER TABLE guestbook ENABLE ROW LEVEL SECURITY;

-- 任何人可读
CREATE POLICY "留言板公开可读" ON guestbook
  FOR SELECT USING (true);

-- 任何人可写（前端已校验，此处为兜底约束）
CREATE POLICY "留言板公开可写" ON guestbook
  FOR INSERT WITH CHECK (
    length(body) > 0 AND length(body) <= 1000
    AND length(nickname) <= 50
    AND length(delete_token) > 0
  );

-- 删除操作：只允许通过 delete_guestbook_msg 函数（SECURITY DEFINER），
-- 此处不创建 DELETE 策略，确保 anon 用户无法直接删除
-- （若已误创建，请执行: DROP POLICY IF EXISTS "留言板token可删除" ON guestbook）


-- 安全删除函数：必须同时匹配 id 和 delete_token 才可删除
-- SECURITY DEFINER 绕过 RLS，是删除的唯一入口
CREATE OR REPLACE FUNCTION delete_guestbook_msg(msg_id BIGINT, token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM guestbook WHERE id = msg_id AND delete_token = token;
  RETURN FOUND;
END;
$$;
