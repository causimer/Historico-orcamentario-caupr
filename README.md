# Histórico Orçamentário - CAU/PR

Aplicação estática no Firebase Hosting. O navegador usa Firebase Authentication e Firestore para acesso e armazenamento dos retratos importados. `public/app.js` mantém os cálculos e a importação existente; `public/pdf-import.js` lê a coluna Na Data dos PDFs SISCONT.

## Laboratório Implanta

A entrada fica abaixo de Minha conta. `public/lab-bootstrap.js` identifica a conta autorizada e solicita `implantaLab/module` com `getDocFromServer`. O servidor restringe a leitura pelo UID e e-mail presentes no token Firebase. As regras negam listagem e escrita de clientes nessa coleção. O módulo, a documentação e as respostas preservadas não são arquivos de Hosting.

`lab-src/implanta-core.mjs` valida períodos e URLs, consulta doze fontes públicas com timeout/limite de bytes, preserva JSON/bytes/hash e usa centavos BigInt. `lab-src/laboratory.mjs` oferece exploração, gráficos de populações selecionadas e comparação somente leitura com retratos. Consultas novas ficam na sessão; não há sincronização automática ou escrita nos retratos pelo laboratório.

## Verificação

Execute `npm test` com Node moderno. Os testes sintéticos não precisam de rede. O teste adicional de uma resposta oficial requer `IMPLANTA_AUDIT_FIXTURE` apontando para o JSON preservado da auditoria; sem essa variável ele informa skip. As evidências e a documentação privada não são mantidas neste repositório público.

Execute `npm run build:lab` para gerar `build/laboratory.mjs` e seu SHA-256. O módulo gerado deve ser publicado administrativamente no documento `implantaLab/module` com campos string `content`, `sha256` e `version`. O build não faz upload. Não copie o módulo ou as evidências para `public`.

O laboratório também lê os documentos privados `documentation` e `reconciliation` (campo `content`), `contract` (`content` do Swagger), `index` (`content` contendo uma lista JSON de `{id,asset,label}`) e os documentos de evidência apontados pelo índice (`url`, `endpoint`, `raw`, `sha256`, `collectedAt`, `status`, `kind`). Os hashes de evidência precisam corresponder aos bytes UTF-8 originais. O administrador publica esses documentos usando IAM; um cliente do aplicativo não pode alterá-los.

## Publicação e reversão

Revise o diff e execute os testes antes de usar `firebase deploy --only firestore:rules,hosting --project historico-orcamentario-caupr`. Confira as regras publicadas e a release de Hosting antes da alteração e preserve seus identificadores. Uma nova publicação de Hosting não publica automaticamente os documentos privados do laboratório.

`firebase.json` serve `public` e configura revalidação dos arquivos de inicialização do laboratório. `index.html` inclui uma referência versionada a `app.js` para atualização da sessão existente. Nenhuma regra pode ser substituída por uma cópia antiga sem verificar as coleções em uso: o painel utiliza `snapshotsDetalhe`, `config/categorias`, `config/apelidosContas` e `users`.

Uma release anterior pode ser restaurada no Firebase Hosting. Reversão de código não restaura retratos apagados ou substituídos. O backup do aplicativo exporta parte dos dados do domínio; a documentação privada descreve o alcance e as lacunas de recuperação.
