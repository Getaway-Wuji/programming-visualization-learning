#include <stdio.h>
int main(void) {
    int n = 30;
    int values[30] = {30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1};
    for (int end = n - 1; end > 0; end = end - 1) {
        for (int j = 0; j < end; j = j + 1) {
            if (values[j] > values[j + 1]) {
                int temp = values[j];
                values[j] = values[j + 1];
                values[j + 1] = temp;
            }
        }
    }
    for (int i = 0; i < n; i = i + 1) {
        if (i > 0) {
            printf(" ");
        }
        printf("%d", values[i]);
    }
    printf("\n");
    return 0;
}
