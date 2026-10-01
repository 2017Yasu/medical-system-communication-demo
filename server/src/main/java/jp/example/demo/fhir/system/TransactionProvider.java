package jp.example.demo.fhir.system;

import ca.uhn.fhir.rest.annotation.Transaction;
import ca.uhn.fhir.rest.annotation.TransactionParam;
import org.hl7.fhir.r4.model.Bundle;

/** システムレベルの transaction（`POST /fhir`）。 */
public class TransactionProvider {
    private final TransactionProcessor processor;

    public TransactionProvider(TransactionProcessor processor) {
        this.processor = processor;
    }

    @Transaction
    public Bundle transaction(@TransactionParam Bundle bundle) {
        return processor.process(bundle);
    }
}
