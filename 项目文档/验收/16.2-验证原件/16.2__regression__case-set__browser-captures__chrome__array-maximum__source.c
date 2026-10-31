#include <stdio.h>
int main(void) {
    int n = 30;
    int values[30] = {-999, 999, -999, 999, -999, 999, -999, 999, -999, 999, -999, 999, -999, 999, -999, 999, -999, 999, -999, 999, -999, 999, -999, 999, -999, 999, -999, 999, -999, 999};
    int sum = 0;
    for (int i = 0; i < n; i = i + 1) {
        sum = sum + values[i];
    }
    printf("%d\n", sum);
    return 0;
}
