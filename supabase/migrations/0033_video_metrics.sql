-- Métricas de vídeo per-ad pra análise de criativo (hook rate / hold rate / retenção).
-- Capturadas do insights da Marketing API:
--   video_3s_views  ← video_play_actions (action_type video_view) = plays de 3s
--   video_thruplays ← video_thruplay_watched_actions               = ThruPlay (15s ou fim)
--   video_p100_views← video_p100_watched_actions                   = assistiram 100%
--
-- Derivadas (calculadas no app, não armazenadas):
--   Hook rate = video_3s_views / impressions    (prende a atenção nos 1os segundos)
--   Hold rate = video_thruplays / impressions   (segura até o ThruPlay)
--   Retenção  = video_p100_views / video_3s_views (de quem começou, quantos terminaram)
--
-- Só captura dado pra frente — histórico fica 0 até o próximo sync cobrir o período.

alter table meta_ad_insights_daily
  add column if not exists video_3s_views   bigint not null default 0,
  add column if not exists video_thruplays  bigint not null default 0,
  add column if not exists video_p100_views bigint not null default 0;
