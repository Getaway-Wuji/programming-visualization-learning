#include <stdio.h>
int main(void) {
    int n = 30;
    int values[30] = {30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1};
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
