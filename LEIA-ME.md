# Finanças 2026: app de lançamentos para a planilha FINANCAS_2026.xlsx

Este app roda no navegador do celular e pode ser instalado na tela inicial do Galaxy S24 FE (Chrome → ⋮ → **Adicionar à tela inicial / Instalar app**). Ele grava direto no arquivo do OneDrive, nas abas **Receitas, Despesas, Cartões, Empréstimo e Viagem**. As outras abas (Plan1, Investimento, Fluxo, Metas, Futuros, IRPF) não são alteradas e se recalculam sozinhas quando a planilha é aberta no Excel.

## Como ele grava

- **Despesas, Receitas, Viagem e Empréstimo:** o valor é somado à célula do mês, no mesmo formato que você já usa (`=43.9+25.5`). A descrição vira uma linha no comentário da célula ("16/11 Taishi Sushi").
- **Cartões:** cada compra vai para a próxima coluna livre da linha do cartão, na fatura escolhida. O comentário segue o seu padrão ("Restaurantes - 14/11 / Madrecita…"). Compras parceladas são distribuídas pelas faturas seguintes como "PARC 01/06", "PARC 02/06" e assim por diante.
- Só as células do lançamento são alteradas. Formatação, fórmulas, comentários existentes e as demais abas ficam intactos.
- Sem internet, os lançamentos ficam numa fila e são gravados quando a conexão voltar.
- Cada lançamento pode ser **desfeito** pelo Histórico, desde que a célula não tenha sido mexida depois.
- Opcional: o app mantém um registro de tudo em `Lancamentos_App.csv`, na mesma pasta da planilha.

## Instalação (uma vez, cerca de 15 minutos)

### 1. Publicar o app (GitHub Pages, gratuito)

1. Crie uma conta em github.com, se ainda não tiver.
2. Crie um repositório **público** chamado `financas`.
3. Clique em **Add file → Upload files** e envie **o conteúdo** desta pasta: `index.html`, `app.js`, `xcore.js`, `sw.js`, `manifest.webmanifest` e a pasta `icons`. Depois clique em **Commit**.
4. Abra **Settings → Pages**, escolha **Branch: main / (root)** e clique em **Save**.
5. Em um ou dois minutos o app estará em `https://SEU-USUARIO.github.io/financas/`.

Só o código do app fica no GitHub, sem nenhum dado financeiro e sem senha. Os dados vão direto do celular para o seu OneDrive.

### 2. Registrar o app na Microsoft (para permitir o acesso ao OneDrive)

1. Acesse **portal.azure.com** com a mesma conta Microsoft do OneDrive. Desde 2024 a Microsoft exige um "diretório" para registrar apps. Se aparecer um aviso de que a conta não pertence a um diretório, crie a conta gratuita do Azure (pode pedir cartão só para verificação; o registro de app não tem custo).
2. Abra **Microsoft Entra ID → Registros de aplicativo → Novo registro**.
   - Nome: `Finanças 2026`
   - Tipos de conta: **Somente contas pessoais da Microsoft**
   - URI de redirecionamento: plataforma **Aplicativo de página única (SPA)**, com o endereço do passo 1 exatamente igual, com a barra no final (`https://SEU-USUARIO.github.io/financas/`). O app mostra esse endereço em **Ajustes**, com um botão para copiar.
3. Clique em **Registrar** e copie o **ID do aplicativo (cliente)**.
4. Em **Permissões de API**, confira se estão as permissões delegadas do Microsoft Graph `User.Read`, `Files.ReadWrite` e `offline_access`. Se faltar alguma, adicione. Você vai consentir na primeira vez que entrar.

### 3. Configurar no celular

1. Abra o endereço do app no Chrome do S24 FE.
2. Vá em **Ajustes**, cole o **Client ID** e toque em **Entrar com a conta Microsoft**.
3. O caminho padrão é `Anexos/Planilha com IA/FINANCAS_2026.xlsx`. Se o app não encontrar o arquivo (a pasta "Anexos" às vezes tem outro nome interno), toque em **Procurar no OneDrive** e escolha a planilha.
4. No menu ⋮ do Chrome, toque em **Adicionar à tela inicial** para usar como aplicativo.

A sessão da Microsoft para apps desse tipo dura cerca de 24 horas. Depois disso, o indicador no topo mostra **Entrar**: basta tocar nele, e os lançamentos feitos nesse meio-tempo continuam na fila.

## Cuidados

- Evite lançar pelo celular enquanto estiver editando a planilha no Excel do computador. O app detecta conflitos e tenta de novo, mas se o arquivo estiver bloqueado ele avisa e mantém o lançamento na fila.
- O OneDrive guarda o histórico de versões do arquivo (clique com o botão direito no arquivo → **Histórico de versões**), o que serve como cópia de segurança.
- Limites da própria planilha: Empréstimo vai até Dez/2026. Despesas, Receitas, Cartões e Viagem vão até Mar/2027. Parcelas que passarem disso não são lançadas, e o app avisa antes de gravar.
- Para a planilha de 2027, se ela mantiver a mesma estrutura, basta trocar o caminho do arquivo em **Ajustes**.

## Modo de teste

Em **Ajustes → Abrir arquivo** você pode carregar uma cópia do .xlsx salva no celular, fazer lançamentos e baixar a cópia alterada para conferir no Excel, sem conectar ao OneDrive.
