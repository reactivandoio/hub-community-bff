# Integração Hub Community - Eventando

## Form

O form para inscrição dos eventos no Hub Community deve ser preenchido com as seguintes informações:
- **Nome do Inscrito**: Nome de quem está realizando a inscrição.
- **Email do Inscrito**: Email de contato do inscrito.
- **Número de Telefone**: Telefone para contato.

Essas são as informações mínimas necessárias para a inscrição dos eventos no Hub Community.

Após o preenchimento do form, os dados serão enviados para o backend do Eventando, que processará a inscrição e fará a comunicação com o inscrito.

## Flow

1. O usuário preenche o form com as informações necessárias.
2. Criamos uma entidade SignUp no backend Eventando com os dados do usuário.
3. O Hub Community recebe como resposta os dados do pagamento do evento.
4. O usuário é notificado sobre o status da inscrição e do pagamento.
5. O usuário paga o evento através do link/QRCode fornecido pelo Hub Community.
6. Após a confirmação do pagamento, o usuário recebe a confirmação de inscrição no evento.

## Implementação Técnica

1. Adicionar o campo `event_id` na entidade Event do Hub Community para mapear o evento do Eventando.
2. Criar a entidade SignUp no backend do Eventando para armazenar as inscrições dos usuários.
3. Implementar o recebimento da resposta pelo Hub Community com os dados do pagamento.
4. Gerar o link/QRCode para pagamento do evento.
5. Mostrar os dados de pagamento para o usuário.
6. Implementar confirmação de pagamento no frontend do Hub Community.

## Pós lançamento
- Monitorar o funcionamento do fluxo de inscrição e pagamento.
- Coletar feedback dos usuários para melhorias futuras.
- Adicionar token de autenticação para segurança nas comunicações entre o Hub Community e o Eventando.