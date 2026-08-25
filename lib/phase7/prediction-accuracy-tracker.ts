import { SupabaseClient } from '@supabase/supabase-js';

export class PredictionAccuracyTracker {
  constructor(private supabase: SupabaseClient) {}

  async recordPredictionOutcome(
    organizationId: string,
    predictionId: string,
    actualValue: number,
    predictedValue: number
  ) {
    const error = Math.abs(actualValue - predictedValue);
    const errorPercentage = (error / Math.abs(predictedValue)) * 100;
    const accuracy = Math.max(0, 100 - errorPercentage);

    const { data, error: dbError } = await this.supabase
      .from('forecast_outcomes')
      .insert({
        organization_id: organizationId,
        prediction_id: predictionId,
        actual_value: actualValue,
        error_percentage: errorPercentage,
        accuracy_score: accuracy,
        measurement_date: new Date().toISOString().split('T')[0],
        measured_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (dbError) throw dbError;
    return data;
  }

  async getModelAccuracy(organizationId: string) {
    const { data: outcomes } = await this.supabase
      .from('forecast_outcomes')
      .select('accuracy_score, error_percentage')
      .eq('organization_id', organizationId);

    if (!outcomes || outcomes.length === 0) {
      return { accuracy: 0, mape: 0, sampleSize: 0 };
    }

    const accuracy = outcomes.reduce((sum, o) => sum + (o.accuracy_score || 0), 0) / outcomes.length;
    const mape = outcomes.reduce((sum, o) => sum + (o.error_percentage || 0), 0) / outcomes.length;

    return {
      accuracy: Math.round(accuracy),
      mape: Math.round(mape),
      sampleSize: outcomes.length,
    };
  }
}
