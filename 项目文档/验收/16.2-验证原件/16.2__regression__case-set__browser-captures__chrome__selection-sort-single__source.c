#include <stdio.h>
int main(void) {
    int n = 1;
    int values[1] = {-999};
    for (int i = 0; i < n - 1; i = i + 1) {
        int minIndex = i;
        for (int j = i + 1; j < n; j = j + 1) {
            if (values[j] < values[minIndex]) {
                minIndex = j;
            }
        }
        if (minIndex != i) {
            int temp = values[i];
            values[i] = values[minIndex];
            values[minIndex] = temp;
        }
    }
    for (int k = 0; k < n; k = k + 1) {
        if (k > 0) {
            printf(" ");
        }
        printf("%d", values[k]);
    }
    printf("\n");
    return 0;
}
