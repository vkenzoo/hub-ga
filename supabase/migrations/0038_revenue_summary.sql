-- Soma de receita no BANCO (evita o corte de 1000 linhas do PostgREST).
--
-- Antes o Resumo trazia todas as purchases e somava no JS — mas a query sem
-- ORDER BY batia no limite de linhas do PostgREST e devolvia as MAIS ANTIGAS,
-- deixando as vendas de hoje de fora (Receita "Hoje" = 0) e subcontando a
-- Receita acumulada.
--
-- Esta função soma server-side a receita líquida real (net_amount quando houver,
-- senão amount) de vendas pagas: total (histórico) + período + renovações + nº.
-- p_start/p_end em UTC (timestamptz); null = sem limite daquele lado.

create or replace function hub_revenue_summary(
  p_start timestamptz default null,
  p_end timestamptz default null
)
returns table (
  total_revenue numeric,
  period_revenue numeric,
  period_renewal_revenue numeric,
  period_sales_count bigint
)
language sql
stable
as $$
  select
    coalesce(sum(coalesce(net_amount, amount)) filter (where status = 'paid'), 0) as total_revenue,
    coalesce(sum(coalesce(net_amount, amount)) filter (
      where status = 'paid'
        and (p_start is null or created_at >= p_start)
        and (p_end is null or created_at < p_end)
    ), 0) as period_revenue,
    coalesce(sum(coalesce(net_amount, amount)) filter (
      where status = 'paid'
        and coalesce(subscription_cycle, 1) > 1
        and (p_start is null or created_at >= p_start)
        and (p_end is null or created_at < p_end)
    ), 0) as period_renewal_revenue,
    count(*) filter (
      where status = 'paid'
        and (p_start is null or created_at >= p_start)
        and (p_end is null or created_at < p_end)
    ) as period_sales_count
  from purchases;
$$;
