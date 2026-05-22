"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";

type MatchType = "contains" | "equals" | "starts_with" | "regex";

interface RuleFormProps {
  questionMap: Record<string, string[]>;  // pergunta → array de respostas únicas
  formIds: string[];                       // form_ids únicos disponíveis
  createAction: (formData: FormData) => Promise<void>;
}

export function RuleForm({ questionMap, formIds, createAction }: RuleFormProps) {
  const questions = Object.keys(questionMap);
  const [selectedQuestion, setSelectedQuestion] = useState<string>(questions[0] ?? "");
  const [matchType, setMatchType] = useState<MatchType>("equals");
  const availableAnswers = questionMap[selectedQuestion] ?? [];

  const hasData = questions.length > 0;
  const isFreeText = matchType === "regex" || matchType === "contains" || matchType === "starts_with";

  return (
    <form action={createAction} className="card">
      <header className="px-4 py-3 border-b border-line">
        <h2 className="text-sm font-medium">Nova regra</h2>
        <p className="text-xs text-muted mt-1">
          "Se a resposta da pergunta X casar com Y, classifica como Lead Z."
          Quando 2 regras casam com a mesma resposta, vence a mais antiga.
        </p>
      </header>
      <div className="p-4 space-y-3">
        {!hasData && (
          <div className="card border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
            Nenhuma resposta recebida ainda. Configure o webhook em <strong>Setup</strong> e dispare uma resposta de teste pra popular as opções aqui.
          </div>
        )}

        <label className="block">
          <span className="label block mb-1.5">Pergunta</span>
          <select
            name="question_key"
            value={selectedQuestion}
            onChange={(e) => setSelectedQuestion(e.target.value)}
            required
            className="input"
            disabled={!hasData}
          >
            <option value="" disabled>
              {hasData ? "Selecione a pergunta" : "Sem respostas ainda"}
            </option>
            {questions.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-3">
          <label className="block">
            <span className="label block mb-1.5">Tipo de match</span>
            <select
              name="match_type"
              value={matchType}
              onChange={(e) => setMatchType(e.target.value as MatchType)}
              className="input"
            >
              <option value="equals">Igual a</option>
              <option value="contains">Contém</option>
              <option value="starts_with">Começa com</option>
              <option value="regex">Regex (avançado)</option>
            </select>
          </label>

          <label className="block">
            <span className="label block mb-1.5">
              Resposta
              {matchType === "equals" && availableAnswers.length > 0 && (
                <span className="text-2xs text-muted ml-2">
                  ({availableAnswers.length} {availableAnswers.length === 1 ? "resposta vista" : "respostas vistas"})
                </span>
              )}
            </span>
            {matchType === "equals" ? (
              <select
                name="answer_pattern"
                required
                className="input"
                disabled={!selectedQuestion}
                defaultValue=""
              >
                <option value="" disabled>
                  {selectedQuestion ? "Selecione a resposta" : "Selecione a pergunta antes"}
                </option>
                {availableAnswers.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  name="answer_pattern"
                  list={`answers-${selectedQuestion}`}
                  placeholder={
                    matchType === "regex"
                      ? "ex: ^Acima de.*$"
                      : matchType === "starts_with"
                        ? "ex: Acima"
                        : "ex: 55 Anos"
                  }
                  required
                  className="input"
                />
                {selectedQuestion && availableAnswers.length > 0 && (
                  <datalist id={`answers-${selectedQuestion}`}>
                    {availableAnswers.map((a) => (
                      <option key={a} value={a} />
                    ))}
                  </datalist>
                )}
                <p className="text-2xs text-muted mt-1">
                  {matchType === "regex"
                    ? "Padrão regex JavaScript. Flag 'i' já aplicada (case-insensitive)."
                    : `Sugestões disponíveis baseadas nas respostas já recebidas.`}
                </p>
              </>
            )}
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[180px_180px_1fr] gap-3">
          <label className="block">
            <span className="label block mb-1.5">Classificação</span>
            <select name="classification" defaultValue="a" className="input">
              <option value="a">Lead A</option>
              <option value="b">Lead B</option>
              <option value="c">Lead C</option>
              <option value="d">Lead D</option>
              <option value="e">Lead E</option>
            </select>
          </label>

          <label className="block">
            <span className="label block mb-1.5">Form (opcional)</span>
            <select name="form_id" defaultValue="" className="input">
              <option value="">Todos os forms</option>
              {formIds.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="label block mb-1.5">Descrição (opcional)</span>
            <input
              name="description"
              placeholder="Pra que serve essa regra"
              className="input"
            />
          </label>
        </div>
      </div>
      <footer className="px-4 py-3 border-t border-line flex justify-end">
        <SubmitButton pendingLabel="Salvando...">Criar regra</SubmitButton>
      </footer>
    </form>
  );
}
