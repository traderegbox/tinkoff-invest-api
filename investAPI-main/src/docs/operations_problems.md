#Особенности методов сервиса операций, которые необходимо учитывать при работе

##На что нужно обратить внимание в методах получения списка операций

1. id операций могут меняться со временем.
2. По инструментам, прошедшим корпоративные действия, история операций может быть не полной как в api, так и в мобильном приложении.
   Для получения точной информации рекомендуем воспользоваться [брокерским отчетом](/investAPI/operations/#getbrokerreport).
3. В id комиссий приходит parent_operation_id .
4. В методе [getOperations](/investAPI/operations#getoperations), информация возвращаемая по операциям с опционами отображается не корректно. 
Для получения списка операций с опционами необходимо использовать метод [getOperationsByCursor](/investAPI/operations#getoperationsbycursor).
5. Получение списка операций методом [getOperationsByCursor](/investAPI/operations#getoperationsbycursor) рекомендуется использовать limit>2, что бы избежать проблем
с задублированными операциями и не возможностью перемещаться по cursor. 
6. Все типы операций, подразумевающие начисление и выплаты по погашению облигаций, вариационной марже, дивидендам, налогам не отображают данные о количестве инструментов по которым произошли начисления.