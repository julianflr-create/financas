# Finanças 2026: instruções de instalação

App para o Galaxy S24 FE que faz lançamentos direto na planilha **FINANCAS_2026.xlsx**, guardada em **OneDrive › Documentos**.

## O que o app faz

O app grava nas abas **Receitas, Despesas, Cartões, Empréstimo, Viagem e Investimento**. Plan1, Fluxo, Metas, Futuros e IRPF não são alteradas pelo app e continuam sendo editadas direto no Excel.

| Aba | Como grava |
|---|---|
| Despesas, Receitas, Viagem, Empréstimo | Soma o valor na célula do mês (`=43.9+25.5`). A descrição vira comentário na célula. |
| Cartões | Usa a próxima coluna livre do cartão na fatura escolhida. Parcelas vão para as faturas seguintes ("PARC 01/06"). |
| Investimento | **Aplicação** vai para a coluna **Entrada** e **Resgate** vai para a coluna **Saída** do grupo, no mês escolhido. Só estes grupos são editáveis: Poupança Poupex, Poupança Ouro, BB RF LP High, Tesouro Selic 2031, Conta XP, Criptomoedas e Ações no Banco do Brasil. |

A tela **Resumo** mostra Receitas, **Despesas**, despesas por categoria, faturas de cartão e, em **Outros**, os totais de **Aplicação** e **Resgate** do mês (soma das colunas Entrada e Saída dos 7 grupos de investimento, incluindo a Conta XP). No final aparece o **Saldo do Mês** (linha SALDO da Plan1) do mês escolhido. O app recalcula o saldo com as mesmas fórmulas da Plan1, então ele já inclui os lançamentos gravados. É o mesmo valor que o Excel mostra ao abrir a planilha.

Limites da própria planilha: Empréstimo e Investimento vão até **Dez/2026**. Despesas, Receitas, Cartões e Viagem vão até **Mar/2027**.

---

## Se você já instalou a versão anterior

1. No GitHub, abra o repositório `financas` e clique em **Add file → Upload files**.
2. Envie os arquivos novos `index.html`, `app.js`, `xcore.js` e `sw.js` (podem ser todos os arquivos do zip, sem problema) e clique em **Commit changes**.
3. Espere de 1 a 2 minutos. No celular, feche o app e abra de novo.
4. Na primeira abertura, o app troca sozinho o caminho antigo (Anexos) por **Documentos/FINANCAS_2026.xlsx** e localiza o arquivo. Em **Ajustes**, o caminho pode aparecer como `Documents/FINANCAS_2026.xlsx`: é o nome interno que o OneDrive usa para a pasta Documentos, e está certo.

Não é preciso mexer no Azure nem entrar de novo na conta.

---

## Instalação do zero

### 1. Publicar o app no GitHub Pages (gratuito)

1. Entre em **github.com** (crie uma conta, se precisar).
2. Clique em **New repository**, use o nome `financas`, marque **Public** e clique em **Create repository**.
3. Clique em **uploading an existing file** (ou **Add file → Upload files**) e arraste **o conteúdo** da pasta do zip: `index.html`, `app.js`, `xcore.js`, `sw.js`, `manifest.webmanifest`, `LEIA-ME.md` e a pasta `icons`. Não envie a pasta `financas-app` inteira, só o que está dentro dela. Clique em **Commit changes**.
4. Vá em **Settings → Pages**. Em *Source*, escolha **Deploy from a branch**, depois **Branch: main** e **/(root)**, e clique em **Save**.
5. Após 1 a 2 minutos, o topo dessa página mostra **"Your site is live at https://SEU-USUARIO.github.io/financas/"**. Esse é o endereço do app. Troque `SEU-USUARIO` pelo seu usuário do GitHub; não use o texto de exemplo.

No GitHub fica só o código do app, sem dados financeiros e sem senha.

### 2. Registrar o app na Microsoft

O registro dá ao app permissão para ler e gravar a planilha no seu OneDrive.

1. Abra uma **janela anônima** no navegador do computador.
2. Se você ainda não tem conta no Azure, crie a conta gratuita em **azure.microsoft.com/pt-br/free** com **a mesma conta Microsoft do OneDrive**. Sem isso, o portal mostra o erro `401 – Erro ao carregar o conteúdo`, porque a conta pessoal não tem um diretório próprio. O cadastro pode pedir cartão só para verificação; o registro do app não gera cobrança.
3. Em outra janela anônima, entre em **entra.microsoft.com** ou **portal.azure.com**. Se aparecer mais de um diretório, clique no seu perfil → **Trocar diretório** e escolha o seu ("Diretório padrão").
4. Abra **Microsoft Entra ID → Registros de aplicativo → Novo registro** e preencha:
   - **Nome:** `Finanças 2026`
   - **Tipos de conta com suporte:** *Somente contas pessoais da Microsoft*
   - **URI de redirecionamento:** escolha a plataforma **Aplicativo de página única (SPA)** e cole o endereço do passo 1.5, **com a barra no final**, por exemplo `https://julianflr.github.io/financas/`.
5. Clique em **Registrar** e copie o **ID do aplicativo (cliente)**, que tem este formato: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.
6. Abra **Permissões de API** e confira se estão as permissões delegadas do Microsoft Graph `User.Read`, `Files.ReadWrite` e `offline_access`. Se faltar alguma: **Adicionar uma permissão → Microsoft Graph → Permissões delegadas**.

### 3. Configurar no celular (S24 FE)

1. Abra o endereço do app no **Chrome**.
2. Toque em **Ajustes** (canto inferior direito).
3. Cole o **Client ID** do passo 2.5.
4. Confira o **endereço de redirecionamento** mostrado em Ajustes. Ele precisa ser idêntico ao cadastrado no Azure; use o botão **Copiar** se precisar corrigir lá.
5. Confira o caminho do arquivo: **`Documentos/FINANCAS_2026.xlsx`**.
6. Toque em **Entrar com a conta Microsoft** e aceite as permissões.
7. Se o app avisar que não encontrou o arquivo, toque em **Procurar no OneDrive** e escolha a planilha da pasta Documentos.
8. No menu **⋮** do Chrome, toque em **Adicionar à tela inicial → Instalar**. O app passa a abrir como um aplicativo normal.

### 4. Primeiro teste

1. Faça um lançamento pequeno, por exemplo uma despesa de R$ 1,00 com a descrição "teste".
2. Abra a planilha no Excel e confira a célula e o comentário.
3. Volte ao app e use **Histórico → Desfazer** para retirar o teste.

---

## Uso no dia a dia

- **Mês da planilha:** use as setas ‹ › no topo. Na aba Cartão, elas escolhem a **fatura**.
- **Estorno:** o botão "− estorno" lança o valor como negativo.
- **Sem internet:** o lançamento fica na fila (o indicador no topo mostra a quantidade) e é gravado sozinho quando a conexão voltar.
- **Sessão expirada:** a sessão da Microsoft dura cerca de 24 horas. Quando o indicador mostrar **Entrar**, toque nele. Os lançamentos da fila não se perdem.
- **Registro:** o arquivo `Lancamentos_App.csv`, na mesma pasta da planilha, guarda data, valor, descrição e células alteradas de cada lançamento.
- **Cópia de segurança:** o OneDrive guarda o histórico de versões. No site do OneDrive, clique com o botão direito no arquivo e escolha **Histórico de versões**.

## Problemas comuns

| Mensagem | O que fazer |
|---|---|
| `404 – There isn't a GitHub Pages site here` | O endereço está errado ou o Pages não foi ativado. Confira o passo 1.4 e copie o endereço exato de Settings → Pages. |
| `401 – Erro ao carregar o conteúdo` no Azure | A conta Microsoft ainda não tem diretório. Faça o passo 2.2 e entre de novo em janela anônima. |
| Erro de redirecionamento no login (`redirect_uri`) | O endereço cadastrado no Azure não é idêntico ao do app. Copie o que aparece em Ajustes, com a barra final, e confira se a plataforma é **SPA**. |
| "Não encontrei … no OneDrive" | Use **Procurar no OneDrive** em Ajustes. |
| "A planilha está bloqueada para edição" | A planilha está aberta e sendo editada em outro lugar. Feche-a no Excel e toque no indicador do topo para gravar. |
| "A célula … foi alterada depois deste lançamento" (ao desfazer) | A célula foi mexida depois do lançamento. Desfaça direto no Excel. |

## Modo de teste (sem OneDrive)

Em **Ajustes → Abrir arquivo**, escolha uma cópia do .xlsx salva no celular e faça lançamentos à vontade. Depois toque em **Baixar cópia da planilha** e confira no Excel. Nada é enviado ao OneDrive nesse modo.
