// config.js — TUDO que muda de uma cidade para outra fica aqui.
// Script comum (sem "export"): as telas carregam com <script src="config.js"> e o background.js com "import './config.js'".
// Depois de editar, vá em chrome://extensions e clique em ⟳ (recarregar) na extensão.
globalThis.MIA = {
  // ----- cidade -----
  cidade: 'Coxim',
  uf: 'MS',                       // vai no cálculo da taxa de entrega ao lançar pedido
  ddd: '67',                      // DDD usado quando o telefone vem sem DDD
  sufixoLoja: 'Coxim',            // confirmado no painel: todas as lojas terminam em " - Coxim". Tira o " - Coxim" do fim do nome das lojas no painel. Se o painel não usa sufixo, deixe ''
  hashtag: '#CoximMS',            // hashtag principal das legendas de Marketing

  // ----- app do cliente (aba Marketing lê promoções, banners, novidades) -----
  // Como achar: abra https://maisdeliveryapp.com.br/pwa/ , escolha Coxim, aperte F12 > Application > Local Storage
  // > chave "@mais/delivery/dataStateCity": copie idCidade e idMarketplace. Sem eles o Marketing funciona, mas sem ler o app.
  idCidade: '553',                // lido do app e do painel em 14/10/2026
  idMarketplace: '369',            // lido do app em 14/10/2026
  lojaTesteId: '110965',          // MEKI LANCHE FELIZ - TESTES (lojas com "teste" no nome já são ignoradas de qualquer jeito)

  // ----- servidor (Cloudflare Worker, veja LEIA-PRIMEIRO.txt) -----
  servidor: 'https://mia-coxim.andrebrittocoxim.workers.dev',
};
