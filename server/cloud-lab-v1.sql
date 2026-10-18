-- TidyLab 云数据库迁移 v1：实验室共享空间（v2.2 功能）
--
-- 背景：上线版原先为"一人一账号、账号间数据完全隔离"（PRD §13.2）。实验室属公共区域，
--       需要同一实验室的成员共同查看/维护同一份收纳数据，同时保留"个人空间"。
--
-- 模型：空间 = 个人空间（lab_id IS NULL）| 实验室空间（lab_id = 某实验室）
--       RLS 放行规则：owner_id = auth.uid()  OR  lab_id ∈ 我的实验室
--       写入仍记录 owner_id（创建者），因此"谁入库的/谁取走的"依旧可追溯。
--
-- 执行方式：WorkBuddy 云服务工具 workbuddy_cloudservice_db_exec_sql（mode = migrate）
--           ⚠️ 每次调用只能提交一条语句；下面按 BLOCK 分块，每块一个 DO 块（单事务，原子）
--           ⚠️ 语句顺序不可调换：建表 → 加列 → 建函数 → 建策略/触发器 → 授权
-- 幂等性：全部 IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS

-- ============================================================
-- BLOCK 1：新建 labs / lab_members，并给 9 张业务表加 lab_id
-- ============================================================
DO $mig$
DECLARE t text;
BEGIN
  CREATE TABLE IF NOT EXISTS public.labs (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name              text NOT NULL,
    owner_id          text NOT NULL DEFAULT auth.uid(),
    owner_name        text,
    invite_code       text NOT NULL UNIQUE,
    invite_expires_at timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS public.lab_members (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lab_id       bigint NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
    user_id      text NOT NULL DEFAULT auth.uid(),
    display_name text,
    role         text NOT NULL DEFAULT 'editor' CHECK (role IN ('owner','editor','viewer')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (lab_id, user_id)
  );
  COMMENT ON TABLE public.labs IS 'TidyLab 实验室共享空间：成员共同维护同一份收纳数据';
  COMMENT ON TABLE public.lab_members IS 'TidyLab 实验室成员：owner 管理员 / editor 可编辑 / viewer 只读';

  CREATE INDEX IF NOT EXISTS labs_owner_idx ON public.labs(owner_id);
  CREATE INDEX IF NOT EXISTS lab_members_user_idx ON public.lab_members(user_id);
  CREATE INDEX IF NOT EXISTS lab_members_lab_idx ON public.lab_members(lab_id);

  ALTER TABLE public.labs ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.lab_members ENABLE ROW LEVEL SECURITY;
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.labs TO authenticated, anon;
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lab_members TO authenticated, anon;

  FOREACH t IN ARRAY ARRAY['zones','cabinets','shelves','boxes','items','item_images','placements','logs','intake_queue'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS lab_id bigint REFERENCES public.labs(id) ON DELETE CASCADE', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(lab_id)', 'idx_'||t||'_lab', t);
    EXECUTE format('COMMENT ON COLUMN public.%I.lab_id IS %L', t, '所属实验室；NULL = 个人空间');
  END LOOP;
END $mig$;

-- ============================================================
-- BLOCK 2：权限辅助函数（每条语句单独一次 exec_sql 调用）
-- ============================================================

-- 我加入的实验室 id 集合。SECURITY DEFINER：避免 RLS 策略里再查 lab_members 造成递归；
-- 函数体内强制 user_id = auth.uid()，因此不可能返回别人的实验室。
CREATE OR REPLACE FUNCTION public.my_lab_ids() RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT lab_id FROM public.lab_members WHERE user_id = auth.uid()
$fn$;

-- 我能"写"的实验室 id 集合（owner / editor；viewer 只读）
CREATE OR REPLACE FUNCTION public.my_editable_lab_ids() RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT lab_id FROM public.lab_members WHERE user_id = auth.uid() AND role IN ('owner','editor')
$fn$;

-- owner_id 不可篡改：实验室成员之间可以互相编辑数据，但不能伪造/转移数据的归属人
CREATE OR REPLACE FUNCTION public.lock_owner_id() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.owner_id := OLD.owner_id;
  RETURN NEW;
END
$fn$;

-- 加入实验室：唯一必须走受控函数的一步。
-- 加入前用户既读不到 labs（非成员），也写不了 lab_members（插入策略要求是实验室管理员），
-- 所以由 SECURITY DEFINER 函数校验邀请码后代为写入。
CREATE OR REPLACE FUNCTION public.join_lab(p_code text, p_display_name text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_lab public.labs;
  v_uid text := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
BEGIN
  IF v_uid IS NULL OR v_uid = '' THEN
    RAISE EXCEPTION '请先登录后再加入实验室';
  END IF;
  IF v_code = '' THEN
    RAISE EXCEPTION '请输入邀请码';
  END IF;
  SELECT * INTO v_lab FROM public.labs WHERE invite_code = v_code;
  IF v_lab.id IS NULL THEN
    RAISE EXCEPTION '邀请码无效，请向实验室管理员确认';
  END IF;
  IF v_lab.invite_expires_at IS NOT NULL AND v_lab.invite_expires_at < now() THEN
    RAISE EXCEPTION '邀请码已过期，请向实验室管理员索取新的邀请码';
  END IF;
  INSERT INTO public.lab_members (lab_id, user_id, display_name, role)
  VALUES (v_lab.id, v_uid, nullif(btrim(coalesce(p_display_name, '')), ''), 'editor')
  ON CONFLICT (lab_id, user_id) DO NOTHING;
  RETURN jsonb_build_object('id', v_lab.id, 'name', v_lab.name, 'owner_name', v_lab.owner_name);
END
$fn$;

-- ============================================================
-- BLOCK 3：策略重写 + owner_id 锁 + 函数授权（单事务，要么全生效要么全不变）
-- ============================================================
DO $mig$
DECLARE t text;
BEGIN
  -- 3.1 九张业务表：读 = 本人 或 本实验室；写 = 本人 或 可编辑的实验室
  FOREACH t IN ARRAY ARRAY['zones','cabinets','shelves','boxes','items','item_images','placements','logs','intake_queue'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_sel', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_ins', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_upd', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_del', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated, anon USING (owner_id = auth.uid() OR lab_id IN (SELECT public.my_lab_ids()))', t||'_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated, anon WITH CHECK (owner_id = auth.uid() AND (lab_id IS NULL OR lab_id IN (SELECT public.my_editable_lab_ids())))', t||'_ins', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated, anon USING (owner_id = auth.uid() OR lab_id IN (SELECT public.my_editable_lab_ids())) WITH CHECK (owner_id = auth.uid() OR lab_id IN (SELECT public.my_editable_lab_ids()))', t||'_upd', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated, anon USING (owner_id = auth.uid() OR lab_id IN (SELECT public.my_editable_lab_ids()))', t||'_del', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t||'_lock_owner', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.lock_owner_id()', t||'_lock_owner', t);
  END LOOP;

  -- 3.2 labs：仅管理员可改名 / 重置邀请码 / 删除
  EXECUTE 'DROP POLICY IF EXISTS labs_sel ON public.labs';
  EXECUTE 'DROP POLICY IF EXISTS labs_ins ON public.labs';
  EXECUTE 'DROP POLICY IF EXISTS labs_upd ON public.labs';
  EXECUTE 'DROP POLICY IF EXISTS labs_del ON public.labs';
  EXECUTE 'CREATE POLICY labs_sel ON public.labs FOR SELECT TO authenticated, anon USING (owner_id = auth.uid() OR id IN (SELECT public.my_lab_ids()))';
  EXECUTE 'CREATE POLICY labs_ins ON public.labs FOR INSERT TO authenticated, anon WITH CHECK (owner_id = auth.uid())';
  EXECUTE 'CREATE POLICY labs_upd ON public.labs FOR UPDATE TO authenticated, anon USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid())';
  EXECUTE 'CREATE POLICY labs_del ON public.labs FOR DELETE TO authenticated, anon USING (owner_id = auth.uid())';
  EXECUTE 'DROP TRIGGER IF EXISTS labs_lock_owner ON public.labs';
  EXECUTE 'CREATE TRIGGER labs_lock_owner BEFORE UPDATE ON public.labs FOR EACH ROW EXECUTE FUNCTION public.lock_owner_id()';

  -- 3.3 lab_members：成员可见同室成员（便于显示名单）；插入仅限实验室管理员；
  --     更新（改角色）仅限管理员；删除 = 自己退出，或管理员移出成员
  EXECUTE 'DROP POLICY IF EXISTS lab_members_sel ON public.lab_members';
  EXECUTE 'DROP POLICY IF EXISTS lab_members_ins ON public.lab_members';
  EXECUTE 'DROP POLICY IF EXISTS lab_members_upd ON public.lab_members';
  EXECUTE 'DROP POLICY IF EXISTS lab_members_del ON public.lab_members';
  EXECUTE 'CREATE POLICY lab_members_sel ON public.lab_members FOR SELECT TO authenticated, anon USING (user_id = auth.uid() OR lab_id IN (SELECT public.my_lab_ids()))';
  EXECUTE 'CREATE POLICY lab_members_ins ON public.lab_members FOR INSERT TO authenticated, anon WITH CHECK (user_id = auth.uid() AND lab_id IN (SELECT id FROM public.labs WHERE owner_id = auth.uid()))';
  EXECUTE 'CREATE POLICY lab_members_upd ON public.lab_members FOR UPDATE TO authenticated, anon USING (lab_id IN (SELECT id FROM public.labs WHERE owner_id = auth.uid())) WITH CHECK (lab_id IN (SELECT id FROM public.labs WHERE owner_id = auth.uid()))';
  EXECUTE 'CREATE POLICY lab_members_del ON public.lab_members FOR DELETE TO authenticated, anon USING (user_id = auth.uid() OR lab_id IN (SELECT id FROM public.labs WHERE owner_id = auth.uid()))';

  -- 3.4 函数执行权限（默认 PUBLIC；这里显式授予已登录用户）
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.my_lab_ids() TO authenticated, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.my_editable_lab_ids() TO authenticated, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.join_lab(text, text) TO authenticated, anon';
END $mig$;

-- ============================================================
-- 备注
-- ============================================================
-- · categories 保持全局公开读（预设分类不属于某个实验室），不参与本次改造。
-- · 现有数据全部 lab_id IS NULL，即天然归属各自的"个人空间"，无需回填；升级方式见下。
-- · 把个人空间数据整体搬进实验室由前端调用（受 RLS 约束，无需额外函数）：
--     UPDATE <table> SET lab_id = <labId> WHERE lab_id IS NULL;   -- 对 9 张表各执行一次
--   前端入口：实验室页「导入我的个人数据」。因为 WHERE 只有 lab_id IS NULL，
--   而个人数据的写权限同样是 owner_id = auth.uid()，所以只会搬到自己的数据。
-- · 图片归属：个人空间 images 存 users/<uid>/…；实验室空间存 shared/<uid>/labs/<labId>/…。
--   云存储没有"按实验室鉴权"这一档——shared/ 前缀对"应用内所有已登录用户"可读，
--   实验室级隔离由「路径不可猜 + 数据表 RLS」共同保证。
