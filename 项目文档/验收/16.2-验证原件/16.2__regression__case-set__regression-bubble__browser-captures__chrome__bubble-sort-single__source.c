#include <stdio.h>
int main(void) {
    int n = 1;
    int values[1] = {-999};
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
